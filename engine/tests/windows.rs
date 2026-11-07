//! What the engine does only on Windows (ADR 0090). `banda menu` reaches
//! the window at a named pipe (decision 5): the pipe the engine names,
//! which the window's own code (client/desktop/src/door.ts) opens on Node,
//! as the window does, and which no other account may write to.
#![cfg(windows)]

mod common;

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::Duration;

/// What lets a holder write a line to the pipe, or make it let one:
/// writing its data, making another of its ends, changing its access list
/// or its owner, and the generic write and all.
const WRITES: u32 = 0x2 | 0x4 | 0x4_0000 | 0x8_0000 | 0x4000_0000 | 0x1000_0000;
/// Who may, beside the account the window runs as: SYSTEM, the
/// Administrators and the owner's rights.
const TRUSTED: [&str; 3] = ["S-1-5-18", "S-1-5-32-544", "S-1-3-4"];

fn menu(state: &Path, route: &str) -> Output {
    common::banda_in(state, state, &["menu", route])
}

/// Where the engine with its places in `dir` says the window listens:
/// what `banda serve --with-parent` tells the window it starts.
fn named_pipe(dir: &Path) -> String {
    let mut engine = engine(dir)
        .args(["serve", "--with-parent"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(engine.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    // Its stdin closes: it stops, as it does when the window goes.
    drop(engine.stdin.take());
    assert!(engine.wait().unwrap().success());
    let running: serde_json::Value = serde_json::from_str(&line).unwrap();
    running["window"].as_str().unwrap().to_owned()
}

/// `banda` with each of its places in `dir`.
fn engine(dir: &Path) -> Command {
    let mut command = common::on(&dir.join("config"));
    for (variable, place) in [
        ("BANDA_ROOT", "root"),
        ("BANDA_DATA", "data"),
        ("BANDA_STATE", "state"),
        ("BANDA_CACHE", "cache"),
    ] {
        command.env(variable, dir.join(place));
    }
    command
        .env("BANDA_THUMBNAILS", "")
        .env("BANDA_LOG", "warn")
        .env_remove("BANDA_TOKEN")
        .env_remove("BANDA_ENGINE")
        .env_remove("BANDA_ENGINE_AS");
    command
}

/// The window's door.ts listening at `pipe`, on Node 22.6 or later, which
/// GitHub's Windows runner has: `menu` answers ok, or, for the route
/// `gone`, what a window with no menu to open says. It stops when its
/// stdin closes.
fn window_at(pipe: &str) -> Child {
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client/desktop/src/door.ts");
    let strips = Command::new("node")
        .args(["-p", "process.features.typescript || ''"])
        .output()
        .expect("Node 22.6 or later runs the window's door.ts");
    let mut node = Command::new("node");
    if String::from_utf8_lossy(&strips.stdout).trim().is_empty() {
        node.arg("--experimental-strip-types");
    }
    node.args([
        "--input-type=module",
        "-e",
        "const [door, pipe] = process.argv.slice(1)\n\
         const { pathToFileURL } = await import('node:url')\n\
         const { openDoor } = await import(pathToFileURL(door).href)\n\
         openDoor(pipe, { menu: (route) => (route === 'gone' ? 'no window' : 'ok') })\n\
         process.stdin.on('end', () => process.exit(0)).resume()",
    ])
    .arg(source)
    .arg(pipe)
    .stdin(Stdio::piped())
    .spawn()
    .unwrap()
}

/// What the pipe at `pipe` says of itself, as Windows' own .NET reads it:
/// the account asking, the pipe's owner, then each rule, `Allow` or
/// `Deny`, the account it is for and the rights it gives or takes.
struct Access {
    me: String,
    owner: String,
    rules: Vec<(String, String, u32)>,
}

fn access_of(pipe: &str) -> Access {
    let name = pipe.strip_prefix(r"\\.\pipe\").unwrap();
    let script = format!(
        "$ErrorActionPreference = 'Stop'\n\
         $sid = [System.Security.Principal.SecurityIdentifier]\n\
         $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', '{name}', [System.IO.Pipes.PipeDirection]::In)\n\
         $pipe.Connect(5000)\n\
         try {{\n\
           $access = $pipe.GetAccessControl()\n\
           [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value\n\
           $access.GetOwner($sid).Value\n\
           foreach ($rule in $access.GetAccessRules($true, $true, $sid)) {{\n\
             '{{0}} {{1}} {{2}}' -f $rule.AccessControlType, $rule.IdentityReference.Value, $rule.PipeAccessRights.value__\n\
           }}\n\
         }} finally {{ $pipe.Dispose() }}"
    );
    let windows = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
    let out = Command::new(
        PathBuf::from(windows).join(r"System32\WindowsPowerShell\v1.0\powershell.exe"),
    )
    .args(["-NoProfile", "-NonInteractive", "-Command", &script])
    .output()
    .unwrap();
    assert!(out.status.success(), "{out:?}");
    let said = String::from_utf8(out.stdout).unwrap();
    let mut lines = said.lines().map(str::trim).filter(|line| !line.is_empty());
    let me = lines.next().unwrap().to_owned();
    let owner = lines.next().unwrap().to_owned();
    let rules = lines
        .map(|line| {
            let [kind, account, rights] = line.split(' ').collect::<Vec<_>>()[..] else {
                panic!("a rule reads {line:?}")
            };
            // .NET gives the rights as a signed number.
            let rights = rights.parse::<i64>().unwrap() as u32;
            (kind.to_owned(), account.to_owned(), rights)
        })
        .collect();
    Access { me, owner, rules }
}

#[test]
fn the_window_hears_banda_menu_at_the_pipe_the_engine_names_and_no_other_account_may_write_to_it() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("state");
    let pipe = named_pipe(dir.path());
    assert!(
        pipe.starts_with(&format!(r"\\.\pipe\{}-window-", env!("BANDA_FOLDER"))),
        "{pipe}"
    );

    let out = menu(&state, "actions");
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "banda: Banda's window is not open.\n"
    );

    let mut window = window_at(&pipe);
    // The door opens a moment after Node starts.
    let heard = common::wait_for(Duration::from_secs(20), || {
        let out = menu(&state, "project.My Work");
        out.status.success().then_some(out)
    });
    assert!(heard.is_some(), "banda menu never reached the window");
    let out = menu(&state, "gone");
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "banda: Banda's window said: no window\n"
    );

    // `banda menu` was heard, so the Person may write; whether through
    // their own account or the Administrators', as on the runner, where
    // an admin's objects are the Administrators'.
    let Access { me, owner, rules } = access_of(&pipe);
    let writers = rules
        .iter()
        .filter(|(kind, _, rights)| kind == "Allow" && rights & WRITES != 0)
        .map(|(_, account, _)| account.as_str());
    for writer in writers {
        assert!(
            writer == me || TRUSTED.contains(&writer),
            "{writer} may write to the window's pipe; its owner is {owner}: {rules:?}"
        );
    }
    // Its owner may change its access list.
    assert!(
        owner == me || TRUSTED.contains(&owner.as_str()),
        "the window's pipe is {owner}'s: {rules:?}"
    );
    eprintln!("the window's pipe: owner {owner}, as {me}: {rules:?}");

    drop(window.stdin.take());
    assert!(window.wait().unwrap().success());
}
