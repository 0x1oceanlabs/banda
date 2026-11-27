//! Another machine's engine, for the CLI: `banda pair <machine>` and `banda
//! --host <machine> …` (ADR 0124, decisions 1 and 6; ADR 0081, decision
//! 13). The CLI is a device there, by a key of its own, as a window is.
//!
//! - The machines are those of `hosts.toml`, the file the window reads:
//!   each a name, where ssh goes, and the `banda` there, or none to find
//!   this Banda's own.
//! - `banda pair <machine>` pairs this device by its ssh login, which gives
//!   what the login already gives: it starts that machine's engine where
//!   none runs (`banda start` there), pairs this key (`banda devices add`),
//!   and keeps the host key the machine said, the device this one is and
//!   the door's port, in `cli-hosts.json` in the state.
//! - `banda --host <machine>` reaches that door through ssh (`ssh -W`, the
//!   door's bytes on its stdin and stdout, so no port opens here), and
//!   says hello as that device. The door must prove the host key kept; a
//!   machine that says another's host key is refused as it pairs, as this
//!   device has one key at every door, and a machine that named another's
//!   could carry its hello on to that door.
//!
//! The key is in `cli.key` in the state, readable by its owner alone. An
//! Agent's `banda` has neither: the fence hides the state, and `--host` is
//! refused under a pass.

use crate::client::{Client, Pass};
use crate::places::{FOLDER, Places};
use crate::{Failure, status};
use banda_kernel::{DeviceId, Refusal};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::OnceLock;

/// The machine `--host` names, for every command of this run.
static HOST: OnceLock<String> = OnceLock::new();

/// Says that this run's commands go to `machine`.
pub fn set(machine: String) {
    let _ = HOST.set(machine);
}

/// The machine this run's commands go to; none for this one.
pub fn named() -> Option<&'static str> {
    HOST.get().map(String::as_str)
}

/// One machine of `hosts.toml`.
#[derive(Debug, Deserialize, PartialEq, Eq)]
struct Entry {
    name: String,
    ssh: String,
    banda: Option<String>,
}

#[derive(Deserialize)]
struct Hosts {
    #[serde(default)]
    hosts: Vec<Entry>,
}

/// What this device keeps of a machine it paired at.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Kept {
    /// The host key it said over ssh, which its door must prove.
    pub host_key: String,
    /// The device this one is there.
    pub device: DeviceId,
    /// The port of its door on its loopback.
    pub door: u16,
}

fn invalid(words: impl Into<String>) -> Failure {
    Failure::Refused(Refusal::invalid(words))
}

/// Where ssh goes, and the `banda` there, in characters no shell takes
/// for its own, as the window takes them (`client/desktop/src/hosts.ts`).
fn plain(entry: &Entry) -> bool {
    let destination = |c: char| c.is_ascii_alphanumeric() || "._@:[]/-".contains(c);
    let path = |c: char| c.is_ascii_alphanumeric() || "._/~-".contains(c);
    !entry.ssh.is_empty()
        && !entry.ssh.starts_with('-')
        && entry.ssh.chars().all(destination)
        && entry.banda.as_deref().is_none_or(|banda| {
            (banda.starts_with('/') || banda.starts_with("~/")) && banda.chars().all(path)
        })
}

/// Machine `name` of `text`, `hosts.toml`'s.
fn entry_in(text: &str, name: &str) -> Result<Entry, Failure> {
    let hosts: Hosts = toml::from_str(text)
        .map_err(|error| invalid(format!("hosts.toml does not read: {error}")))?;
    let found = hosts.hosts.into_iter().find(|one| one.name == name);
    match found {
        Some(entry) if plain(&entry) => Ok(entry),
        Some(_) => Err(invalid(format!(
            "hosts.toml's {name} has an ssh or a banda that Banda does not take."
        ))),
        None => Err(invalid(format!(
            "There is no machine \"{name}\" in hosts.toml: add it in Settings → Machines, or \
             there, as [[hosts]] with name and ssh."
        ))),
    }
}

fn entry(places: &Places, name: &str) -> Result<Entry, Failure> {
    let text = std::fs::read_to_string(places.config.join("hosts.toml")).unwrap_or_default();
    entry_in(&text, name)
}

/// This Banda's name, as its app is called.
fn app_name() -> &'static str {
    match FOLDER {
        "banda" => "Banda",
        "banda-dev" => "Banda Dev",
        _ => "Banda Local",
    }
}

/// What runs `banda <words>` there through `sh`, whatever the login shell
/// is, as the window runs it (`throughSh`): the `banda` of `hosts.toml`,
/// else the first of this Banda's own it finds there: on PATH, the newest
/// copy in its data folder, or macOS's app; with none, it exits 127.
fn remote(banda: Option<&str>, words: &str) -> String {
    let runtime =
        r#"env XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" BANDA_OVER_SSH=1"#;
    let lines = match banda {
        Some(banda) => vec![format!("exec {runtime} {banda} {words}")],
        None => vec![
            r#"case $(uname) in Darwin) d="$HOME/Library/Application Support" ;; *) d="${XDG_DATA_HOME:-$HOME/.local/share}" ;; esac"#.to_owned(),
            format!(
                r#"b=$(command -v {FOLDER}) || b=$(ls -1d "$d"/{FOLDER}/engine/*/banda 2>/dev/null | sort -V | tail -n 1)"#
            ),
            format!(
                r#"[ -x "$b" ] || b="/Applications/{}.app/Contents/Resources/banda""#,
                app_name()
            ),
            format!(
                r#"[ -x "$b" ] || {{ echo "no {} here" >&2; exit 127; }}"#,
                app_name()
            ),
            format!(r#"exec {runtime} "$b" {words}"#),
        ],
    };
    format!("sh -c '{}'", lines.join("; "))
}

/// ssh's own options here: no terminal, no forward of the config's, and a
/// machine that does not answer given up soon. It may ask, as a
/// passphrase, on the Person's terminal.
const SSH: [&str; 7] = [
    "-T",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "RemoteCommand=none",
];

/// What `banda <words>` printed on `entry`'s machine, over ssh; why not,
/// in the Person's words, when it ended badly.
async fn said(entry: &Entry, words: &str) -> Result<String, Failure> {
    let output = tokio::process::Command::new("ssh")
        .args(SSH)
        .arg("--")
        .arg(&entry.ssh)
        .arg(remote(entry.banda.as_deref(), words))
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .output()
        .await
        .map_err(|error| Failure::broken(format!("ssh did not start: {error}")))?;
    let printed = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    match output.status.code() {
        Some(0) => Ok(printed),
        Some(255) => Err(Failure::broken(format!(
            "ssh could not reach {}.",
            entry.ssh
        ))),
        Some(127) => Err(Failure::broken(format!(
            "No {} found on {}: install it there, or set banda in hosts.toml.",
            app_name(),
            entry.name
        ))),
        // Its own refusal, as it printed it.
        _ => match serde_json::from_str::<serde_json::Value>(&printed) {
            Ok(refused) if refused.get("error").is_some() => {
                let refusal = serde_json::from_value(refused["error"].clone());
                Err(refusal.map_or_else(Failure::broken, Failure::Refused))
            }
            _ => Err(Failure::broken(format!(
                "banda on {} could not do its part.",
                entry.name
            ))),
        },
    }
}

/// This device's key, in `cli.key` in the state, made there on first use.
fn key(places: &Places) -> Result<Ed25519KeyPair, Failure> {
    let file = places.state.join("cli.key");
    let read = |bytes: &[u8]| Ed25519KeyPair::from_pkcs8(bytes).map_err(Failure::broken);
    if let Ok(bytes) = std::fs::read(&file) {
        return read(&bytes);
    }
    let made = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).map_err(Failure::broken)?;
    banda_kernel::host::write_private(&file, made.as_ref()).map_err(Failure::broken)?;
    read(made.as_ref())
}

/// The machines this device paired at, by name.
fn kept(places: &Places) -> BTreeMap<String, Kept> {
    std::fs::read(places.state.join("cli-hosts.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// `kept` with `name` held to `now`; refused where another machine of
/// those kept said that host key first.
fn held(
    mut kept: BTreeMap<String, Kept>,
    name: &str,
    now: Kept,
) -> Result<BTreeMap<String, Kept>, Failure> {
    if let Some((other, _)) =
        (kept.iter()).find(|(other, one)| *other != name && one.host_key == now.host_key)
    {
        return Err(invalid(format!(
            "{name} says the host key that {other} proved: it is not paired. If {other} is this \
             machine under another name, remove one."
        )));
    }
    kept.insert(name.to_owned(), now);
    Ok(kept)
}

/// A name for this device there: this machine's, and that it is the CLI,
/// in what a command there carries.
async fn device_name(places: &Places) -> String {
    let machine = banda_machines::Machine::new(&places.config, banda_machines::found().await);
    let host = machine.named().borrow().name.clone();
    let clean: String = (host.chars())
        .filter(|c| c.is_alphanumeric() || " ._-".contains(*c))
        .take(48)
        .collect();
    match clean.trim() {
        "" => "banda CLI".to_owned(),
        host => format!("{host} CLI"),
    }
}

/// `banda pair <machine>`: pairs this device there by its ssh login, and
/// prints what it is there.
pub async fn pair(places: &Places, name: &str) -> Result<(), Failure> {
    if Pass::from_env()?.is_some() {
        return Err(Failure::Refused(Refusal::forbidden(
            "banda pair is the Person's: an Agent pairs no device.",
        )));
    }
    let entry = entry(places, name)?;
    // It starts the engine where none runs, and says how it runs.
    let running: status::Status = serde_json::from_str(&said(&entry, "start").await?)
        .map_err(|_| Failure::broken(format!("banda on {name} said something unexpected.")))?;
    let (Some(door), Some(host_key)) = (running.door, running.host_key) else {
        return Err(Failure::broken(format!(
            "{} on {name} is older than its door: update it there.",
            app_name()
        )));
    };
    let key = key(places)?;
    let public = URL_SAFE_NO_PAD.encode(key.public_key().as_ref());
    let words = format!(
        "devices add --key {public} --name \"{}\" --kind cli",
        device_name(places).await
    );
    let added: serde_json::Value = serde_json::from_str(&said(&entry, &words).await?)
        .map_err(|_| Failure::broken(format!("banda on {name} said something unexpected.")))?;
    let device: DeviceId = serde_json::from_value(added["ok"]["id"].clone())
        .map_err(|_| Failure::broken(format!("{name} did not pair this device.")))?;
    let now = Kept {
        host_key,
        device,
        door,
    };
    let all = held(kept(places), name, now.clone())?;
    let bytes = serde_json::to_vec_pretty(&all).map_err(Failure::broken)?;
    banda_kernel::host::write_private(&places.state.join("cli-hosts.json"), &bytes)
        .map_err(Failure::broken)?;
    println!(
        "{}",
        json!({ "ok": { "machine": name, "device": now.device, "host_key": now.host_key } })
    );
    Ok(())
}

/// A client of `name`'s engine, at its door, as the device this one is
/// there.
pub async fn connect(places: &Places, name: &str) -> Result<Client, Failure> {
    if Pass::from_env()?.is_some() {
        return Err(Failure::Refused(Refusal::forbidden(
            "banda --host is the Person's: an Agent's banda acts on the machine it runs on.",
        )));
    }
    let entry = entry(places, name)?;
    let Some(kept) = kept(places).remove(name) else {
        return Err(invalid(format!(
            "This device is not paired on {name}. Pair it once: banda pair {name}"
        )));
    };
    let mut ssh = tokio::process::Command::new("ssh")
        .args(SSH)
        .arg("-W")
        .arg(format!("127.0.0.1:{}", kept.door))
        .arg("--")
        .arg(&entry.ssh)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| Failure::broken(format!("ssh did not start: {error}")))?;
    let (Some(to), Some(from)) = (ssh.stdin.take(), ssh.stdout.take()) else {
        return Err(Failure::broken("ssh gave no pipe."));
    };
    // It ends as its pipes close, with this program.
    drop(ssh);
    let nowhere = format!(
        "{name}'s door does not answer through ssh: its Banda may be stopped. Start it there, \
         or pair again: banda pair {name}"
    );
    Client::at_door(
        Box::new(tokio::io::join(from, to)),
        &kept,
        &key(places)?,
        &nowhere,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOML: &str = "[[hosts]]\nname = \"arc\"\nssh = \"roma@arc\"\n\n[[hosts]]\nname = \"mac\"\n\
                        ssh = \"m1\"\nbanda = \"~/bin/banda-dev\"\n\n[[hosts]]\nname = \"evil\"\n\
                        ssh = \"-oProxyCommand=x\"\n";

    #[test]
    fn a_machine_is_one_of_hosts_toml_by_its_name() {
        let arc = entry_in(TOML, "arc").ok().unwrap();
        assert_eq!((arc.ssh.as_str(), arc.banda), ("roma@arc", None));
        let mac = entry_in(TOML, "mac").ok().unwrap();
        assert_eq!(mac.banda.as_deref(), Some("~/bin/banda-dev"));
        assert!(matches!(entry_in(TOML, "evil"), Err(Failure::Refused(_))));
        assert!(matches!(
            entry_in(TOML, "nowhere"),
            Err(Failure::Refused(_))
        ));
        assert!(matches!(entry_in("", "arc"), Err(Failure::Refused(_))));
        assert!(matches!(
            entry_in("[[hosts", "arc"),
            Err(Failure::Refused(_))
        ));
    }

    #[test]
    fn the_command_there_runs_the_banda_named_or_finds_this_one() {
        assert_eq!(
            remote(Some("~/bin/banda-dev"), "start"),
            "sh -c 'exec env XDG_RUNTIME_DIR=\"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}\" \
             BANDA_OVER_SSH=1 ~/bin/banda-dev start'"
        );
        let found = remote(None, "devices list");
        assert!(found.starts_with("sh -c 'case $(uname) in Darwin)"));
        assert!(found.ends_with("\"$b\" devices list'"));
        // Nothing ends sh's quotes.
        assert!(!found[7..found.len() - 1].contains('\''));
    }

    #[test]
    fn a_machine_that_says_another_s_host_key_is_not_paired() {
        let one = |key: &str| Kept {
            host_key: key.to_owned(),
            device: DeviceId::new(),
            door: 22_633,
        };
        let kept = held(BTreeMap::new(), "arc", one("A")).ok().unwrap();
        // Paired again, it is held to what it says now.
        let kept = held(kept, "arc", one("B")).ok().unwrap();
        assert_eq!(kept["arc"].host_key, "B");
        assert!(matches!(
            held(kept.clone(), "devbox", one("B")),
            Err(Failure::Refused(_))
        ));
        assert_eq!(held(kept, "devbox", one("C")).ok().unwrap().len(), 2);
    }
}
