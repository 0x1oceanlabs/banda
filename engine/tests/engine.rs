//! The `banda` program as a window and a script use it: `serve` with a
//! parent, then `call` and `follow` over the API; `banda mcp` as a Harness
//! starts it for an Agent; and `banda` as an Agent runs it in its shell,
//! under its pass. The Harness is the fake agent from `tools/fake-agent`.

mod common;

use banda_harnesses::carried::{ADAPTERS_VARIABLE, NODE_VARIABLE};
use common::wait_for;
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
/// in `mcp`, and what its Agent's shell would be handed for `banda` in
/// `shells`.
struct Places {
    _dir: tempfile::TempDir,
    root: PathBuf,
    state: PathBuf,
    config: PathBuf,
    mcp: PathBuf,
    shells: PathBuf,
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
        let (mcp, shells) = (dir.path().join("mcp.json"), dir.path().join("shells.json"));
        let list = format!(
            "[[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = {:?}\nenv = {{ FAKE_AGENT_MCP = {:?}, FAKE_AGENT_SHELLS = {:?} }}\n",
            fake_agent().display().to_string(),
            mcp.display().to_string(),
            shells.display().to_string(),
        );
        std::fs::write(config.join("harnesses.toml"), list).unwrap();
        Places {
            _dir: dir,
            root,
            state,
            config,
            mcp,
            shells,
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
            .env("BANDA_CACHE", self._dir.path().join("cache"))
            .env("BANDA_THUMBNAILS", "")
            .env("BANDA_LOG", "warn")
            // The test's own engine, as its owner, wherever the tests run:
            // in an Agent's shell too, which hands `banda` a pass and names
            // its Project.
            .env_remove("BANDA_TOKEN")
            .env_remove("BANDA_ENGINE")
            .env_remove("BANDA_PROJECT")
            .env_remove("BANDA_SPACE")
            // A checkout's engine is the window's child, or a `banda
            // serve` of the test's own: never the session's service.
            .env_remove("BANDA_ENGINE_AS")
            // No window started it: no Node nor adapters named, as for a
            // `banda serve` run in a shell.
            .env_remove(NODE_VARIABLE)
            .env_remove(ADAPTERS_VARIABLE)
            .env_remove("ELECTRON_RUN_AS_NODE");
        command
    }

    /// `banda` as an Agent runs it in its shell, with the variables its
    /// session or its Harness's process hands it.
    fn agent(&self, variables: &Value, args: &[&str]) -> Command {
        let mut command = self.banda(args);
        for name in ["BANDA_TOKEN", "BANDA_ENGINE"] {
            command.env(name, text(&variables[name]));
        }
        command
    }

    fn as_agent(&self, variables: &Value, args: &[&str]) -> Output {
        self.agent(variables, args).output().unwrap()
    }

    /// Starts `banda serve --with-parent` and reads the line that says
    /// where it listens.
    fn serve(&self) -> (Child, ChildStdin, Value) {
        self.serve_with(&[])
    }

    /// [`Places::serve`], with `variables` in the engine's own environment.
    fn serve_with(&self, variables: &[(&str, &str)]) -> (Child, ChildStdin, Value) {
        let mut engine = self
            .banda(&["serve", "--with-parent"])
            .envs(variables.iter().copied())
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

    fn call(&self, method: &str, project: Option<&str>, params: Value) -> Output {
        let params = params.to_string();
        let mut args = vec!["call", method, "--params", &params];
        if let Some(project) = project {
            args.extend(["--project", project]);
        }
        self.banda(&args).output().unwrap()
    }

    /// Calls a method that must succeed, and returns what it answered.
    fn ok(&self, method: &str, project: Option<&str>, params: Value) -> Value {
        let output = self.call(method, project, params);
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
    // It names its build, as `banda --version` does after a version that
    // can name a folder: the window checks its copy of `banda` by that
    // line (ADR 0086, decision 2). An ELF's SHA-1 build id, a Mach-O's
    // UUID, or a PE's GUID and its age, which the linker counts from 1.
    let build = text(&running["build"]);
    let length = if cfg!(target_os = "macos") {
        32..=32
    } else if cfg!(windows) {
        33..=40
    } else {
        40..=40
    };
    assert!(length.contains(&build.len()), "{build}");
    assert!(
        build.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "{build}"
    );
    let version = env!("BANDA_VERSION");
    assert!(
        version.starts_with(|first: char| first.is_ascii_alphanumeric())
            && version
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".+_-".contains(c)),
        "{version}"
    );
    let said = places.banda(&["--version"]).output().unwrap();
    assert_eq!(
        String::from_utf8(said.stdout).unwrap(),
        format!("banda {version} (build {build})\n")
    );

    let second = places.banda(&["serve"]).output().unwrap();
    assert_eq!(second.status.code(), Some(2), "{second:?}");
    assert!(second.stdout.is_empty(), "the secret stays off a terminal");
    assert!(String::from_utf8_lossy(&second.stderr).contains("already runs"));

    let project = places.ok("projects.create", None, json!({ "name": "Work" }));
    let project = text(&project["id"]);

    let refused = places.call("agents.thread", Some(project), json!({}));
    assert_eq!(refusal(&refused), "invalid");
    let nowhere = places
        .banda(&["follow", "--project", &uuid::Uuid::now_v7().to_string()])
        .output()
        .unwrap();
    assert_eq!(refusal(&nowhere), "not_found");

    let mut follow = places
        .banda(&["follow", "--project", project, "--module", "agents"])
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
        Some(project),
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
    // The Harness says its slash commands as its session opens: in the
    // turn's first offer, or in another as the turn runs, as it is quick.
    let mut offered = false;
    kinds.retain(|kind| kind != "thread.offered" || !std::mem::replace(&mut offered, true));
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
        Some(project),
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
    let stranger = places.call("projects.list", None, json!({}));
    assert_eq!(refusal(&stranger), "forbidden", "a wrong secret is refused");
    std::fs::write(&file, real).unwrap();

    // The window closes: the engine stops and says it no longer runs.
    drop(stdin);
    assert!(engine.wait().unwrap().success());
    assert!(!places.state.join("engine.json").exists());
    let gone = places.call("projects.list", None, json!({}));
    assert_eq!(gone.status.code(), Some(2), "{gone:?}");
}

/// The code of a refusal the CLI printed, which exits 1.
fn refusal(output: &Output) -> String {
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let answer: Value = serde_json::from_slice(&output.stdout).unwrap();
    text(&answer["error"]["code"]).to_owned()
}

#[test]
fn a_resend_with_its_command_id_answers_what_it_did() {
    let places = Places::new();
    let (mut engine, stdin, _) = places.serve();
    let project = places.ok("projects.create", None, json!({ "name": "Work" }));
    let project = text(&project["id"]);

    // As the CLI says to repeat a call cut short (ADR 0082, decision 4): a
    // file made once answers the same, not "already there".
    let command = uuid::Uuid::now_v7().to_string();
    let make = |name: &str| {
        let params = json!({ "dir": "", "name": name, "kind": "file" }).to_string();
        (places.banda(&["call", "files.make", "--params", &params]))
            .args(["--project", project, "--command", &command])
            .output()
            .unwrap()
    };
    let first = make("a.txt");
    assert!(first.status.success(), "{first:?}");
    let again = make("a.txt");
    assert!(again.status.success(), "{again:?}");
    assert_eq!(again.stdout, first.stdout);
    assert_eq!(refusal(&make("b.txt")), "conflict", "another call, one ID");

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

#[test]
fn bad_params_are_refused_before_the_engine_is_reached() {
    let places = Places::new();
    let output = places
        .banda(&["call", "projects.list", "--params", "{not json"])
        .output()
        .unwrap();
    assert_eq!(refusal(&output), "invalid");
}

/// The adapters Banda carries, as the harnesses' host package builds them
/// in this checkout (ADR 0059): built here when they are not yet, which
/// takes the workspace's npm packages (`pnpm install`).
#[cfg(unix)]
fn carried_adapters() -> PathBuf {
    let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("../platform/harnesses/adapters");
    let dist = package.join("dist");
    if !dist.join("claude-agent-acp.mjs").is_file() {
        let built = Command::new("node")
            .arg("build.mjs")
            .current_dir(&package)
            .status()
            .expect("node runs");
        assert!(built.success(), "the adapters build: run `pnpm install`");
    }
    dunce::canonicalize(dist).unwrap()
}

/// The first `node` on this test's PATH.
#[cfg(unix)]
fn node() -> PathBuf {
    let path = std::env::var_os("PATH").unwrap_or_default();
    (std::env::split_paths(&path).map(|folder| folder.join("node")))
        .find(|node| node.is_file())
        .expect("a node on PATH")
}

// Its Claude Code is a `sh` script.
#[cfg(unix)]
#[test]
fn an_engine_no_window_started_runs_claude_codes_adapter_with_its_shim_on_the_hosts_node() {
    let adapters = carried_adapters();
    let places = Places::new();
    // Banda's own Claude Code entry, with a stand-in of the Person's CLI
    // that only says its version: no model is asked.
    let cli = places._dir.path().join("claude");
    std::fs::write(&cli, "#!/bin/sh\necho '2.1.312 (Claude Code)'\n").unwrap();
    std::fs::set_permissions(&cli, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let list = format!(
        "[[harness]]\nid = \"claude\"\ncli = {{ program = {:?}, variable = \"CLAUDE_CODE_EXECUTABLE\" }}\n",
        cli.display().to_string()
    );
    std::fs::write(places.config.join("harnesses.toml"), list).unwrap();
    let (mut engine, stdin, _) = places.serve();

    // The engine set the program itself: the adapter its checkout built,
    // on the node it found on PATH, with no Electron's variable.
    let listed = places.ok("harnesses.list", None, json!({}));
    let claude = &listed[0];
    assert_eq!(claude["id"], "claude");
    let command: Vec<PathBuf> = (claude["command"].as_array().unwrap().iter())
        .map(|part| PathBuf::from(text(part)))
        .collect();
    assert_eq!(command.len(), 2, "{command:?}");
    assert_eq!(command[0], node());
    assert_eq!(
        dunce::canonicalize(&command[1]).unwrap(),
        adapters.join("claude-agent-acp.mjs")
    );
    let env = claude["env"].as_array().unwrap();
    assert!(!env.contains(&json!("ELECTRON_RUN_AS_NODE")), "{env:?}");
    // The bundle takes the SDK through Banda's shim, which alone reads
    // the folder of a Project's sessions (ADR 0078, decision 3).
    let bundle = std::fs::read_to_string(&command[1]).unwrap();
    assert!(
        bundle.contains("BANDA_CLAUDE_SESSIONS"),
        "the shim is in it"
    );

    // And it starts: the adapter answers who it is, run on that node.
    let account = places.ok("harnesses.account", None, json!({ "harness": "claude" }));
    let adapter = &account["account"]["adapter"];
    assert_eq!(adapter["version"], "0.99.1", "{account}");
    assert_eq!(account["account"]["cli"]["version"], "2.1.312");

    drop(stdin);
    assert!(engine.wait().unwrap().success());
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
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]);
    let sent = places.ok(
        "agents.send",
        Some(work),
        json!({ "harness": "fake", "text": "hello" }),
    );
    let thread = text(&sent["thread"]);

    // The session the agents module opened for the Thread got it.
    let servers = wait_for(Duration::from_secs(30), || {
        // One half written is read again.
        let bytes = std::fs::read(&places.mcp).ok()?;
        serde_json::from_slice::<Value>(&bytes).ok()
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
    assert_eq!(text(&welcome["instructions"]), banda_skill::brief());
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
    // In the list of Apps' order: the Apps', then the platform's.
    let arranging = ["panes", "open_pane", "move_pane", "close_pane"];
    assert_eq!(
        names,
        [
            &[
                "threads",
                "read",
                "send",
                "show_visual",
                "preview_visual",
                "draft_issue",
                "notify",
                "later",
                "wake",
                "browser_tabs",
                "browser_snapshot",
                "browser_screenshot",
                "browser_open",
                "browser_navigate",
                "browser_act",
                "browser_wait_for",
                "browser_handoff",
                "link_pull_request",
                "unlink_pull_request",
                "list_thread_pull_requests",
                "limits",
                "keys_list",
                "keys_bind",
                "keys_free",
                "keys_reset",
                "keys_mod",
                "settings_set",
                "settings_reset",
                "settings_rename",
                "problems",
                "problem"
            ][..],
            &arranging,
            &["skill"]
        ]
        .concat()
    );
    assert_eq!(tools[1]["inputSchema"]["required"], json!(["thread"]));

    // An Agent reads what broke in Banda, to look into it (ADR 0039).
    let (error, listed) = mcp.call(90, "problems", json!({}));
    assert!(!error, "{listed}");
    assert!(serde_json::from_str::<Value>(&listed).unwrap()["problems"].is_array());
    let (error, said) = mcp.call(91, "problem", json!({ "fingerprint": "0000" }));
    assert!(error, "{said}");
    // And how much of the limits is left, before a long task (ADR 0043).
    let (error, limits) = mcp.call(92, "limits", json!({}));
    assert!(!error, "{limits}");
    assert!(serde_json::from_str::<Value>(&limits).unwrap()["limits"].is_array());

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
    let new_thread = json!({ "harness": "fake", "text": "hi" });
    let (error, said) = mcp.call(11, "send", new_thread.clone());
    assert!(!error, "{said}");
    let started = serde_json::from_str::<Value>(&said).unwrap()["thread"].clone();
    assert_ne!(started, thread);
    // A request sent again is one command: it gets the first answer and
    // starts no other Thread (ADR 0082, decision 4).
    let (error, again) = mcp.call(11, "send", new_thread.clone());
    assert!(!error && again == said, "{again}");
    // Its receipt keeps a hash of the arguments: the same request ID that
    // asks otherwise, which MCP forbids, is refused and starts nothing.
    let otherwise = json!({ "harness": "fake", "text": "bye" });
    let (error, other) = mcp.call(11, "send", otherwise);
    assert!(error && other.contains("Refused (conflict)"), "{other}");
    let (error, threads) = mcp.call(20, "threads", json!({}));
    assert!(!error, "{threads}");
    let threads: Value = serde_json::from_str(&threads).unwrap();
    assert_eq!(threads["threads"].as_array().unwrap().len(), 2, "{threads}");

    // It puts its Thread on the screen, in its Project, without the focus.
    let shown = json!({ "kind": "agents.thread", "args": { "thread": thread } });
    let (error, said) = mcp.call(12, "open_pane", shown);
    assert!(!error, "{said}");
    let (error, said) = mcp.call(13, "panes", json!({}));
    assert!(!error, "{said}");
    let seen: Value = serde_json::from_str(&said).unwrap();
    let pane = &seen[0]["columns"][0]["panes"][0];
    assert_eq!(
        (pane["project"].clone(), pane["yours"].clone()),
        (json!(work), json!(true))
    );
    // As a Group of its own, as the agents' window part says a Thread
    // opens (ADR 0065, decision 7).
    let arranged = places.ok("workspaces.list", None, json!({}));
    let column = &arranged["workspaces"][0]["columns"][0];
    assert_eq!(column["panes"][0]["id"], pane["id"]);
    assert!(column["group"].is_string(), "{column}");
    // What it opens with no place goes into that Group, as a Deck right of
    // the Thread: its session's pass names the Thread (ADR 0065, decision
    // 7; ADR 0083, decision 2).
    let changes = json!({ "kind": "git.diff", "args": { "scope": { "kind": "changes" } } });
    let (error, said) = mcp.call(19, "open_pane", changes);
    assert!(!error, "{said}");
    let diff = serde_json::from_str::<Value>(&said).unwrap()["pane"].clone();
    let arranged = places.ok("workspaces.list", None, json!({}));
    let deck = &arranged["workspaces"][0]["columns"][1];
    assert_eq!(deck["panes"][0]["id"], diff, "{arranged}");
    assert_eq!(deck["group"], column["group"], "{deck}");
    assert_eq!(deck["display"], "deck", "{deck}");
    let (error, said) = mcp.call(
        14,
        "open_pane",
        json!({ "kind": "terminal.terminal", "args": {} }),
    );
    assert!(
        error && said.contains("run nothing as your Person"),
        "{said}"
    );
    // The words a Thread's Pane sends first are the Person's to give
    // (ADR 0083, decision 3): its tool says so, and what to call instead.
    let asking = json!({ "thread": null, "ask": "hi" });
    let (error, said) = mcp.call(
        18,
        "open_pane",
        json!({ "kind": "agents.thread", "args": asking }),
    );
    assert!(
        error && said.starts_with("Refused (forbidden): `ask` is your Person's to give"),
        "{said}"
    );
    assert!(said.contains("call `send`"), "{said}");

    // It binds a key that stays in the window; only its Person binds one
    // that acts as them, by its action's id written in any way the look
    // reads it (ADR 0083, decision 3).
    let keys = || std::fs::read_to_string(places.config.join("keys.toml")).unwrap();
    let maximize = json!({ "key": "Alt+M", "action": "column.maximize" });
    let (error, said) = mcp.call(15, "keys_bind", maximize);
    assert!(!error, "{said}");
    let ask = json!({ "key": "Ctrl+Alt+H", "action": "thread.new", "args": { "ask": "hello" } });
    let spaced =
        json!({ "key": "Ctrl+Alt+H", "action": " thread.new", "args": { "ask": "hello" } });
    for (id, bind) in [(16, ask.clone()), (17, spaced)] {
        let (error, said) = mcp.call(id, "keys_bind", bind);
        assert!(
            error && said.starts_with("Refused (forbidden): Only your Person binds"),
            "{said}"
        );
    }
    assert!(!keys().contains("thread.new"), "{}", keys());
    places.ok("keys.bind", None, ask);
    assert!(keys().contains(r#"action = "thread.new""#), "{}", keys());

    let (error, said) = mcp.call(9, "skill", json!({ "topic": "sidebar" }));
    assert!(!error);
    assert!(said.contains("sidebar.toml"), "{said}");
    let unknown = mcp.ask(10, "resources/list", json!({}));
    assert_eq!(unknown["error"]["code"], -32601);
    // Another session numbers its requests from one again: its request 11
    // is a command of its own.
    let mut next = Mcp::start(server);
    let (error, said) = next.call(11, "send", new_thread);
    assert!(!error, "{said}");
    let other = serde_json::from_str::<Value>(&said).unwrap()["thread"].clone();
    assert_ne!(other, started);
    next.end();
    mcp.end();

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

#[test]
fn an_agents_banda_acts_under_its_pass() {
    let places = Places::new();
    let (mut engine, stdin, _) = places.serve();
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]).to_owned();
    let home = places.ok("projects.create", None, json!({ "name": "Home" }));
    let home = text(&home["id"]).to_owned();
    let sent = places.ok(
        "agents.send",
        Some(&work),
        json!({ "harness": "fake", "text": "hello" }),
    );
    let read = |file: &Path| {
        let bytes = std::fs::read(file).ok()?;
        serde_json::from_slice::<Value>(&bytes).ok()
    };
    let shells = wait_for(Duration::from_secs(30), || read(&places.shells))
        .expect("the session told what its shells get");
    let servers = read(&places.mcp).expect("the session got its MCP servers");

    // A session's shell gets the pass its `banda mcp` has, as Claude
    // Code's adapter takes it from the session's request, over the pass of
    // its process, which every Harness's carries: another pass, to the
    // same engine.
    let given: serde_json::Map<String, Value> = (servers[0]["env"].as_array().unwrap().iter())
        .map(|v| (text(&v["name"]).to_owned(), v["value"].clone()))
        .collect();
    let (session, process) = (&shells["session"], &shells["process"]);
    assert_eq!(session, &Value::Object(given));
    assert_eq!(process["BANDA_ENGINE"], session["BANDA_ENGINE"]);
    assert_ne!(process["BANDA_TOKEN"], session["BANDA_TOKEN"]);
    let problem = json!({ "source": "page", "kind": "TypeError", "message": "reading 'x'" });
    let problem = places.ok("problems.record", None, problem);
    let report = ["problems", "report", text(&problem["fingerprint"])];
    let whole = places.banda(&report).output().unwrap();
    assert!(String::from_utf8_lossy(&whole.stdout).contains("## The workspaces of"));

    for (whose, variables) in [("session", session), ("process", process)] {
        // It sees its own Project alone, and a call that names none runs
        // there.
        let listed = places.as_agent(variables, &["call", "projects.list"]);
        assert!(listed.status.success(), "{whose}: {listed:?}");
        let listed: Value = serde_json::from_slice(&listed.stdout).unwrap();
        let ids: Vec<_> = listed["ok"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| text(&p["id"]))
            .collect();
        assert_eq!(ids, [work.as_str()], "{whose}");
        let threads = places.as_agent(variables, &["call", "agents.threads"]);
        assert!(threads.status.success(), "{whose}: {threads:?}");
        let threads: Value = serde_json::from_slice(&threads.stdout).unwrap();
        assert_eq!(threads["ok"]["threads"][0]["id"], sent["thread"], "{whose}");

        // Another Project is past its wall, and the Projects are not its
        // to make or add.
        let elsewhere = ["call", "agents.threads", "--project", &home];
        let elsewhere = places.as_agent(variables, &elsewhere);
        assert_eq!(refusal(&elsewhere), "forbidden", "{whose}");
        let followed = places.as_agent(variables, &["follow", "--project", &home]);
        assert_eq!(refusal(&followed), "forbidden", "{whose}");
        let create = ["call", "projects.create", "--params", r#"{"name":"Mine"}"#];
        let create = places.as_agent(variables, &create);
        assert_eq!(refusal(&create), "forbidden", "{whose}");
        let folder = places.root.display().to_string();
        let add = places.as_agent(variables, &["project", "add", &folder]);
        assert_eq!(refusal(&add), "forbidden", "{whose}");

        // A Problem's report is the module's alone: the workspaces are
        // the machine's, which it sees only through its tools.
        let reported = places.as_agent(variables, &report);
        assert!(reported.status.success(), "{whose}: {reported:?}");
        let reported = String::from_utf8_lossy(&reported.stdout);
        assert!(reported.starts_with("# Problem "), "{whose}: {reported}");
        assert!(!reported.contains("## The workspaces of"), "{whose}");
    }

    // A pass the engine does not know is refused, in words that say so.
    let engine_url = text(&session["BANDA_ENGINE"]);
    let stranger = json!({ "BANDA_TOKEN": "0".repeat(64), "BANDA_ENGINE": engine_url });
    let refused = places.as_agent(&stranger, &["call", "projects.list"]);
    assert_eq!(refusal(&refused), "forbidden");
    let said: Value = serde_json::from_slice(&refused.stdout).unwrap();
    assert!(
        text(&said["error"]["message"]).contains("does not know the pass in BANDA_TOKEN"),
        "{said}"
    );
    // An engine named with no pass for it does nothing, as the owner too.
    let bare = places
        .banda(&["call", "projects.list"])
        .env("BANDA_ENGINE", engine_url)
        .output()
        .unwrap();
    assert_eq!(refusal(&bare), "forbidden");
    let said: Value = serde_json::from_slice(&bare.stdout).unwrap();
    assert!(
        text(&said["error"]["message"]).contains("BANDA_TOKEN holds no pass"),
        "{said}"
    );
    // A call meant for another engine, where BANDA_STATE says, never goes
    // to the pass's.
    let other = places.root.join("other");
    let meant = places
        .agent(session, &["call", "projects.list"])
        .env("BANDA_STATE", &other)
        .output()
        .unwrap();
    assert_eq!(refusal(&meant), "invalid");
    // An engine that does not answer where the pass says is named.
    let gone =
        json!({ "BANDA_TOKEN": session["BANDA_TOKEN"], "BANDA_ENGINE": "ws://127.0.0.1:1/ws" });
    let nowhere = places
        .agent(&gone, &["call", "projects.list"])
        .env_remove("BANDA_STATE")
        .output()
        .unwrap();
    assert_eq!(nowhere.status.code(), Some(2), "{nowhere:?}");
    assert!(String::from_utf8_lossy(&nowhere.stderr).contains("where BANDA_ENGINE says"));

    // A change to Banda's settings under the pass goes to its engine, which
    // writes what an Agent may change and refuses what only the Person
    // does (ADR 0083): behind the fence the files are read-only.
    let border = places.as_agent(
        session,
        &["settings", "set", "look.toml", "tile.border", "3"],
    );
    assert!(border.status.success(), "{border:?}");
    let look = std::fs::read_to_string(places.config.join("look.toml")).unwrap();
    assert!(look.contains("border = 3"), "{look}");
    let full = [
        "settings",
        "set",
        "agents.toml",
        "start.fake.mode",
        "full_access",
    ];
    let refused = places.as_agent(session, &full);
    assert!(!refused.status.success(), "{refused:?}");
    let said = String::from_utf8_lossy(&refused.stdout) + String::from_utf8_lossy(&refused.stderr);
    assert!(said.contains("Only your Person"), "{said}");
    // Nor by another name, set first and renamed to it.
    let other = [
        "settings",
        "set",
        "agents.toml",
        "start.fake.later",
        "full_access",
    ];
    assert!(places.as_agent(session, &other).status.success());
    let renamed = [
        "settings",
        "rename",
        "agents.toml",
        "start.fake.later",
        "mode",
    ];
    let refused = places.as_agent(session, &renamed);
    assert!(!refused.status.success(), "{refused:?}");
    let agents = std::fs::read_to_string(places.config.join("agents.toml")).unwrap_or_default();
    assert!(agents.contains("\nlater = \"full_access\""), "{agents}");
    assert!(!agents.contains("\nmode ="), "{agents}");
    // Its own pass's status: the engine that gave it, and its fence, and
    // not who works and who waits, which is the Person's bar's.
    let status = places.as_agent(session, &["status"]);
    let status: serde_json::Value = serde_json::from_slice(&status.stdout).unwrap();
    assert_eq!(status["running"], true, "{status}");
    assert!(status["fence"]["fence"].is_string(), "{status}");
    assert!(status.get("agents").is_none(), "{status}");
    let follow = places.as_agent(session, &["status", "--follow"]);
    assert!(!follow.status.success(), "{follow:?}");
    let bound = places.as_agent(session, &["keys", "bind", "Alt+M", "column.maximize"]);
    assert!(bound.status.success(), "{bound:?}");
    let keys = std::fs::read_to_string(places.config.join("keys.toml")).unwrap();
    assert!(keys.contains("column.maximize"), "{keys}");

    // A pass with no engine named is no pass: the owner's secret, as before.
    let owner = places
        .banda(&["call", "projects.list"])
        .env("BANDA_TOKEN", text(&session["BANDA_TOKEN"]))
        .output()
        .unwrap();
    assert!(owner.status.success(), "{owner:?}");
    let listed: Value = serde_json::from_slice(&owner.stdout).unwrap();
    assert_eq!(listed["ok"].as_array().unwrap().len(), 2);

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

/// Where the fence does not hold, Full access for a Harness's new Threads
/// is the Person's choice only as they set it through the engine, as
/// Settings writes `agents.toml`: written there otherwise, by hand or by a
/// `banda settings` that reaches no engine, it is no one's, and a new
/// Thread starts Supervised (ADR 0083, F0-3; Roma, 2026-11-08).
#[test]
fn a_new_threads_full_access_is_the_persons_only_as_they_set_it_through_the_engine() {
    let places = Places::new();
    let (mut engine, stdin, _) =
        places.serve_with(&[("BANDA_FENCE", "off"), ("BANDA_LOG", "error")]);
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]).to_owned();
    let mode = || {
        let defaults = places.ok("agents.defaults", Some(&work), json!({ "harness": "fake" }));
        defaults["settings"]["mode"].clone()
    };
    let by_hand = [
        "settings",
        "set",
        "agents.toml",
        "start.fake.mode",
        "full_access",
    ];
    let by_hand = || assert!(places.banda(&by_hand).status().unwrap().success());
    by_hand();
    let agents = std::fs::read_to_string(places.config.join("agents.toml")).unwrap();
    assert!(agents.contains("mode = \"full_access\""), "{agents}");
    assert_eq!(mode(), "supervised", "the file alone");

    let set =
        json!({ "file": "agents.toml", "key": "start.fake.mode", "value": "\"full_access\"" });
    places.ok("keys.settings_set", None, set);
    assert_eq!(mode(), "full_access", "chosen through the engine");
    let reset = json!({ "file": "agents.toml", "key": "start.fake" });
    places.ok("keys.settings_reset", None, reset);
    assert_eq!(mode(), "supervised");
    by_hand();
    assert_eq!(mode(), "supervised", "taken back, then written by hand");

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

#[test]
fn a_project_the_person_does_not_trust_loads_only_their_own_settings() {
    let places = Places::new();
    // Each Harness process is told its own Project's trust, whatever the
    // engine's own environment says.
    let (mut engine, stdin, _) = places.serve_with(&[("BANDA_UNTRUSTED", "1")]);
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    assert_eq!(work["trusted"], json!(true));
    let work = text(&work["id"]).to_owned();
    let sent = places.ok(
        "agents.send",
        Some(&work),
        json!({ "harness": "fake", "text": "hello" }),
    );
    let read = |file: &Path| {
        let bytes = std::fs::read(file).ok()?;
        serde_json::from_slice::<Value>(&bytes).ok()
    };
    let shells = wait_for(Duration::from_secs(30), || read(&places.shells))
        .expect("the session told what it loads");
    assert_eq!(
        (&shells["untrusted"], &shells["sources"]),
        (&json!(""), &json!(null))
    );

    // Its Agent reads whether its Project is trusted, and never changes it.
    let session = &shells["session"];
    let listed = places.as_agent(session, &["call", "projects.list"]);
    let listed: Value = serde_json::from_slice(&listed.stdout).unwrap();
    assert_eq!(listed["ok"][0]["trusted"], json!(true));
    let untrust = json!({ "project": work, "trusted": false }).to_string();
    let untrust = ["call", "projects.trust", "--params", &untrust];
    assert_eq!(refusal(&places.as_agent(session, &untrust)), "forbidden");

    // The Person takes it back: the Thread's next turn runs in a process,
    // and a session, that read only the Person's own settings.
    std::fs::remove_file(&places.shells).unwrap();
    let untrusted = places.ok(
        "projects.trust",
        None,
        json!({ "project": work, "trusted": false }),
    );
    assert_eq!(untrusted["trusted"], json!(false));
    places.ok(
        "agents.send",
        Some(&work),
        json!({ "thread": sent["thread"], "text": "again" }),
    );
    let shells =
        wait_for(Duration::from_secs(30), || read(&places.shells)).expect("a session opened again");
    assert_eq!(shells["untrusted"], json!("1"));
    assert_eq!(shells["sources"], json!(["user"]));

    // A folder added with no word of its trust is trusted unless it looks
    // like another's code; the Person's word wins.
    let holding = |name: &str| {
        let folder = places.root.join(name);
        std::fs::create_dir_all(folder.join(".claude")).unwrap();
        folder.display().to_string()
    };
    let added = |args: &[&str]| {
        let output = places.banda(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["ok"]["trusted"].clone()
    };
    let theirs = holding("theirs");
    assert_eq!(added(&["project", "add", &theirs]), json!(false));
    let mine = holding("mine");
    let mine = ["project", "add", &mine, "--trusted", "true"];
    assert_eq!(added(&mine), json!(true));

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

#[test]
fn an_agent_puts_off_its_own_thread_from_its_shell_and_the_person_any() {
    let places = Places::new();
    let (mut engine, stdin, _) = places.serve();
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]).to_owned();
    let home = places.ok("projects.create", None, json!({ "name": "Home" }));
    let home = text(&home["id"]).to_owned();
    let sent = places.ok(
        "agents.send",
        Some(&work),
        json!({ "harness": "fake", "text": "hello" }),
    );
    let mine = text(&sent["thread"]).to_owned();
    let shells = wait_for(Duration::from_secs(30), || {
        let bytes = std::fs::read(&places.shells).ok()?;
        serde_json::from_slice::<Value>(&bytes).ok()
    })
    .expect("the session told what its shells get");
    let (session, process) = (&shells["session"], &shells["process"]);
    let theirs = places.ok(
        "agents.send",
        Some(&work),
        json!({ "harness": "fake", "text": "hi there" }),
    );
    let theirs = text(&theirs["thread"]).to_owned();
    let elsewhere = places.ok(
        "agents.send",
        Some(&home),
        json!({ "harness": "fake", "text": "hello" }),
    );
    let elsewhere = text(&elsewhere["thread"]).to_owned();
    let later_of = |project: &str, thread: &str| {
        let listed = places.ok("agents.threads", Some(project), json!({}));
        let threads = listed["threads"].as_array().unwrap();
        let found = threads.iter().find(|t| t["id"] == json!(thread));
        found.expect("the Thread is listed")["later"].clone()
    };

    // Its own Thread by default, in its Project, as itself.
    let ran = places.as_agent(session, &["thread", "later", "--after", "30m"]);
    assert!(ran.status.success(), "{ran:?}");
    let later = later_of(&work, &mine);
    assert_eq!(later["by"]["kind"], json!("agent"), "{later}");
    assert!(later["until"].is_i64(), "{later}");
    // Waking it is its own too: `wake` is its tool, as `later` is, and a
    // pass's scopes are its tools (ADR 0083, decision 2).
    let woken = places.as_agent(session, &["thread", "wake"]);
    assert!(woken.status.success(), "{woken:?}");
    assert!(later_of(&work, &mine)["woke"].is_object());
    let named = places.as_agent(session, &["thread", "wake", &mine]);
    assert!(named.status.success(), "awake, it stays so: {named:?}");

    // Another Thread is its Person's, another Project is past its wall,
    // and a pass of no Thread, its Harness's process's, has none of its own.
    let other = ["thread", "later", &theirs, "--after", "30m"];
    assert_eq!(refusal(&places.as_agent(session, &other)), "forbidden");
    let past = [
        "thread",
        "later",
        &elsewhere,
        "--project",
        &home,
        "--after",
        "1h",
    ];
    assert_eq!(refusal(&places.as_agent(session, &past)), "forbidden");
    let named = places
        .agent(session, &["thread", "wake", &elsewhere])
        .env("BANDA_PROJECT", &home)
        .output()
        .unwrap();
    assert_eq!(refusal(&named), "forbidden");
    let bare = ["thread", "later", "--after", "30m"];
    assert_eq!(refusal(&places.as_agent(process, &bare)), "forbidden");
    assert_eq!(later_of(&work, &theirs), json!(null));

    // The Person's CLI puts off any Thread it names, in the Project its
    // terminal names or it is told.
    let any = [
        "thread",
        "later",
        &theirs,
        "--project",
        &work,
        "--after",
        "2h",
    ];
    let any = places.banda(&any).output().unwrap();
    assert!(any.status.success(), "{any:?}");
    assert_eq!(later_of(&work, &theirs)["by"]["kind"], json!("person"));
    let until = (later_of(&work, &mine)["until"].as_i64().unwrap() + 60_000).to_string();
    let there = places
        .banda(&["thread", "later", &elsewhere, "--until", &until])
        .env("BANDA_PROJECT", &home)
        .output()
        .unwrap();
    assert!(there.status.success(), "{there:?}");
    assert_eq!(
        later_of(&home, &elsewhere)["until"],
        json!(until.parse::<i64>().unwrap())
    );
    let unnamed = ["thread", "later", "--project", &work, "--after", "1h"];
    let unnamed = places.banda(&unnamed).output().unwrap();
    assert_eq!(refusal(&unnamed), "invalid");

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

#[test]
fn an_agents_pass_outlives_an_engine_restart_until_its_project_goes() {
    let places = Places::new();
    let (mut engine, stdin, first) = places.serve();
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]).to_owned();
    places.ok(
        "agents.send",
        Some(&work),
        json!({ "harness": "fake", "text": "hello" }),
    );
    let read = |file: &Path| {
        let bytes = std::fs::read(file).ok()?;
        serde_json::from_slice::<Value>(&bytes).ok()
    };
    let shells = wait_for(Duration::from_secs(30), || read(&places.shells))
        .expect("the session told what its shells get");
    let listed = |variables: &Value| {
        let listed = places.as_agent(variables, &["call", "projects.list"]);
        assert!(listed.status.success(), "{listed:?}");
        let listed: Value = serde_json::from_slice(&listed.stdout).unwrap();
        listed["ok"][0]["id"].clone()
    };
    assert_eq!(listed(&shells["session"]), json!(work));

    // The engine stops, as Quit stops it, and starts again where it
    // listened, when no other test's engine took the port meanwhile: the
    // address its passes name stays, and the passes of its sessions and
    // its Harness's process work there.
    drop(stdin);
    assert!(engine.wait().unwrap().success());
    let (mut engine, stdin, again) = places.serve();
    let there = |variables: &Value| {
        let mut variables = variables.clone();
        if again["port"] != first["port"] {
            eprintln!("another engine took port {}", first["port"]);
            variables["BANDA_ENGINE"] = format!("ws://127.0.0.1:{}/ws", again["port"]).into();
        }
        variables
    };
    for whose in ["session", "process"] {
        assert_eq!(listed(&there(&shells[whose])), json!(work), "{whose}");
    }
    let kept = std::fs::read(places.state.join("passes.sqlite3")).unwrap();
    let secret = text(&shells["session"]["BANDA_TOKEN"]);
    assert!(
        !String::from_utf8_lossy(&kept).contains(secret),
        "the store keeps no pass"
    );

    // A Project removed takes its passes with it.
    places.ok("projects.remove", None, json!({ "project": work }));
    let refused = places.as_agent(&there(&shells["session"]), &["call", "projects.list"]);
    assert_eq!(refusal(&refused), "forbidden");

    drop(stdin);
    assert!(engine.wait().unwrap().success());
}

#[test]
fn banda_status_says_whether_the_engine_runs_and_banda_stop_quits_it() {
    let places = Places::new();
    let status = || {
        let said = places.banda(&["status"]).output().unwrap();
        assert!(said.status.success(), "{said:?}");
        serde_json::from_slice::<Value>(&said.stdout).unwrap()
    };
    let idle = status();
    assert_eq!(idle["running"], false, "{idle}");
    // And what the machine is, which another machine's Test shows, read
    // with no engine.
    assert!(idle["system"].is_string(), "{idle}");
    assert!(idle["named"]["name"].is_string(), "{idle}");
    assert!(idle["named"]["icon"].is_string(), "{idle}");
    // With no engine, it says so, and stops nothing.
    let none = places.banda(&["stop"]).output().unwrap();
    assert!(none.status.success(), "{none:?}");
    assert!(String::from_utf8_lossy(&none.stderr).contains("not running"));

    let (mut engine, _stdin, _) = places.serve();
    let now = status();
    assert_eq!(now["running"], true);
    assert_eq!(now["pid"], engine.id());
    assert!(now["since"].as_i64().unwrap() > 0, "{now}");
    assert!(now["version"].is_string(), "{now}");
    assert!(now.get("unit").is_none(), "a test's engine runs in no unit");
    assert!(now.get("secret").is_none());
    // The machine as its engine names it, in its welcome.
    assert_eq!(now["named"], idle["named"], "{now}");
    assert_eq!(now["system"], idle["system"], "{now}");
    // Whether the fence holds, as the engine said in its welcome.
    let fence = now["fence"]["fence"].as_str().unwrap_or_default();
    assert!(["holds", "missing"].contains(&fence), "{now}");

    // While an Agent works, Quit asks first; with no terminal to ask in,
    // it refuses and says how to stop it anyway.
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]).to_owned();
    let wait = json!({ "harness": "fake", "text": "wait" });
    places.ok("agents.send", Some(&work), wait);
    let working = || {
        let threads = places.ok("agents.threads", Some(&work), json!({}));
        (threads["threads"][0]["latest"]["state"] == "running").then_some(())
    };
    wait_for(Duration::from_secs(30), working).expect("the Agent works");
    let asked = places.banda(&["stop"]).output().unwrap();
    assert_eq!(refusal(&asked), "conflict");
    let said: Value = serde_json::from_slice(&asked.stdout).unwrap();
    assert!(
        text(&said["error"]["message"]).starts_with("An Agent is working. Stop it and quit?"),
        "{said}"
    );
    assert_eq!(status()["running"], true, "nothing was stopped");
    // An Agent cannot quit Banda.
    let by_agent = places
        .banda(&["stop", "--force"])
        .env("BANDA_ENGINE", "ws://127.0.0.1:1/ws")
        .env("BANDA_TOKEN", "0".repeat(64))
        .output()
        .unwrap();
    assert_eq!(refusal(&by_agent), "forbidden");

    let stopped = places.banda(&["stop", "--force"]).output().unwrap();
    // banda stop comes to Windows with ADR 0090's step 10.
    if cfg!(windows) {
        let said = String::from_utf8_lossy(&stopped.stderr);
        assert!(said.contains("not on Windows yet"), "{stopped:?}");
        engine.kill().unwrap();
        return;
    }
    assert!(stopped.status.success(), "{stopped:?}");
    let Some(ended) = wait_for(Duration::from_secs(5), || engine.try_wait().unwrap()) else {
        engine.kill().unwrap();
        panic!("the engine did not stop");
    };
    assert!(ended.success(), "{ended:?}");
    assert_eq!(status()["running"], false);

    // The next engine knows the last one stopped: it keeps no crash.
    let (_engine, stdin, _) = places.serve();
    let problems = places.ok("problems.list", None, json!({}));
    assert_eq!(problems["problems"], json!([]), "{problems}");
    drop(stdin);
}

#[test]
fn banda_status_follow_says_who_works_and_who_waits_until_stdin_closes() {
    let places = Places::new();
    // With no engine it says so, and starts none.
    let idle = places.banda(&["status"]).output().unwrap();
    assert!(idle.status.success(), "{idle:?}");
    let idle: Value = serde_json::from_slice(&idle.stdout).unwrap();
    assert_eq!(idle["running"], false, "{idle}");
    assert!(idle.get("agents").is_none(), "{idle}");
    assert!(!places.state.join("engine.json").exists(), "none started");

    // Without a parent, stdin is not watched: with none, it goes on.
    let mut alone = places
        .banda(&["status", "--follow"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut first = String::new();
    let mut out = BufReader::new(alone.stdout.take().unwrap());
    out.read_line(&mut first).unwrap();
    let first: Value = serde_json::from_str(&first).unwrap();
    assert_eq!(first["running"], false, "{first}");
    assert!(alone.try_wait().unwrap().is_none(), "it goes on");
    alone.kill().unwrap();
    alone.wait().unwrap();

    let mut follow = places
        .banda(&["status", "--follow", "--with-parent"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = follow.stdin.take().unwrap();
    let (heard, said) = mpsc::channel();
    let lines = BufReader::new(follow.stdout.take().unwrap());
    std::thread::spawn(move || {
        for line in lines.lines().map_while(Result::ok) {
            let _ = heard.send(serde_json::from_str::<Value>(&line).unwrap());
        }
    });
    // The lines it prints, until one says what `until` looks for.
    let next_until = |until: &dyn Fn(&Value) -> bool| loop {
        let line = said
            .recv_timeout(Duration::from_secs(30))
            .expect("a line comes");
        if until(&line) {
            return line;
        }
    };
    // It says no engine runs, and waits for one.
    let first = next_until(&|_| true);
    assert_eq!(first["running"], false, "{first}");
    assert!(!places.state.join("engine.json").exists(), "none started");

    let (mut engine, engine_stdin, running) = places.serve();
    let line = next_until(&|line| line["running"] == true);
    assert_eq!(line["version"], running["version"], "{line}");
    assert_eq!(line["build"], running["build"], "{line}");
    assert_eq!(line["channel"], "local", "a checkout's: {line}");
    let calm = json!({
        "working": 0, "waiting": 0, "asking": 0, "failed": 0, "done": 0, "threads": [],
    });
    assert_eq!(line["agents"], calm, "{line}");

    // A turn starts: one works.
    let work = places.ok("projects.create", None, json!({ "name": "Work" }));
    let work = text(&work["id"]).to_owned();
    let waits = json!({ "harness": "fake", "text": "wait" });
    let waiting = places.ok("agents.send", Some(&work), waits);
    let line = next_until(&|line| line["agents"]["working"] == 1);
    let rows = &line["agents"]["threads"];
    assert_eq!(rows[0]["thread"], waiting["thread"], "{line}");
    assert_eq!(rows[0]["project"], json!(work), "{line}");
    assert_eq!(rows[0]["project_name"], "Work", "{line}");
    assert_eq!(rows[0]["state"], "working", "{line}");
    assert_eq!(line["agents"]["waiting"], 0, "{line}");
    // Said once, it says the same.
    let once = places.banda(&["status"]).output().unwrap();
    assert!(once.status.success(), "{once:?}");
    let once: Value = serde_json::from_slice(&once.stdout).unwrap();
    assert_eq!(once["agents"]["working"], 1, "{once}");
    assert_eq!(once["agents"]["threads"][0]["thread"], waiting["thread"]);

    // Another asks its Person: one waits, and comes first.
    let asks = json!({ "harness": "fake", "text": "ask" });
    let asking = places.ok("agents.send", Some(&work), asks);
    let line = next_until(&|line| line["agents"]["asking"] == 1);
    let agents = &line["agents"];
    assert_eq!(
        (&agents["working"], &agents["waiting"]),
        (&json!(1), &json!(1)),
        "{line}"
    );
    let order: Vec<_> = (agents["threads"].as_array().unwrap().iter())
        .map(|row| (row["thread"].clone(), row["state"].clone()))
        .collect();
    assert_eq!(
        order,
        [
            (asking["thread"].clone(), json!("asking")),
            (waiting["thread"].clone(), json!("working")),
        ],
        "{line}"
    );

    // The engine goes: it says so, and waits for the next.
    drop(engine_stdin);
    assert!(engine.wait().unwrap().success());
    let gone = next_until(&|line| line["running"] == false);
    assert!(gone.get("agents").is_none(), "{gone}");
    assert!(follow.try_wait().unwrap().is_none(), "it goes on");

    // Its reader closes stdin: it ends.
    drop(stdin);
    let ended = wait_for(Duration::from_secs(10), || follow.try_wait().unwrap());
    let Some(ended) = ended else {
        follow.kill().unwrap();
        panic!("banda status --follow did not end with its stdin");
    };
    assert!(ended.success(), "{ended:?}");
}

#[cfg(unix)]
#[test]
fn an_engine_that_was_killed_is_kept_as_a_crash_by_the_next() {
    let places = Places::new();
    let (mut engine, _stdin, _) = places.serve();
    engine.kill().unwrap();
    engine.wait().unwrap();
    let (mut engine, stdin, _) = places.serve();
    let problems = places.ok("problems.list", None, json!({}));
    let kinds: Vec<_> = (problems["problems"].as_array().unwrap().iter())
        .map(|problem| text(&problem["kind"]).to_owned())
        .collect();
    assert_eq!(kinds, ["crash"], "{problems}");
    drop(stdin);
    assert!(engine.wait().unwrap().success());
}
