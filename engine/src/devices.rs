//! `banda devices` (ADR 0124, decision 6): the devices this machine lets
//! in at its door, from its own console. Whoever runs it here is this
//! machine's console, as its owner is: it pairs a device by its public
//! key, lists them, and removes one, which ends that device's sessions at
//! once. The engine keeps them (the devices module); this only asks it.

use crate::Failure;
use crate::client::Client;
use crate::places::Places;
use banda_devices::DeviceKind;
use banda_kernel::CommandId;
use clap::Subcommand;
use serde_json::{Value, json};

#[derive(Subcommand)]
pub enum DevicesCommand {
    /// Prints this machine's host key and the devices it paired, as JSON.
    List,
    /// Pairs a device by its public key and prints it. One paired already
    /// by that key prints as it is.
    Add {
        /// The device's public key: Ed25519, 32 bytes, as base64url.
        #[arg(long)]
        key: String,
        /// What you read it by; this machine's name for its own window.
        #[arg(long, required_unless_present = "here")]
        name: Option<String>,
        /// desktop, browser, phone or cli.
        #[arg(long, value_parser = kind, default_value = "desktop")]
        kind: DeviceKind,
        /// It is this machine's own window, which pairs itself.
        #[arg(long = "self")]
        here: bool,
        /// The origin of the page it pairs from, as https://arc.example;
        /// none for a program with no page.
        #[arg(long, conflicts_with = "here")]
        origin: Option<String>,
    },
    /// Removes a device, by its ID or its name: its sessions end at once.
    Remove { device: String },
}

/// `--kind`, as `DeviceKind` names itself.
fn kind(name: &str) -> Result<DeviceKind, String> {
    serde_json::from_value(json!(name)).map_err(|_| format!("{name} is no kind of device"))
}

pub async fn devices(places: &Places, what: DevicesCommand) -> Result<(), Failure> {
    let mut client = Client::connect(places).await?;
    let answer = match what {
        DevicesCommand::List => ask(&mut client, "devices.list", json!({})).await?,
        DevicesCommand::Add {
            key,
            name,
            kind,
            here,
            origin,
        } => {
            // Its own window is read by the machine's name.
            let name = name
                .or_else(|| client.named().map(|named| named.name.clone()))
                .unwrap_or_else(|| "This machine".to_owned());
            let params = json!({
                "key": key, "name": name, "kind": kind, "here": here, "origin": origin,
            });
            ask(&mut client, "devices.add", params).await?
        }
        DevicesCommand::Remove { device } => {
            let listed = ask(&mut client, "devices.list", json!({})).await?;
            let named =
                |one: &&Value| one["id"] == device.as_str() || one["name"] == device.as_str();
            let found: Vec<&Value> = (listed["devices"].as_array())
                .map(|all| all.iter().filter(named).collect())
                .unwrap_or_default();
            let [one] = found[..] else {
                return Err(Failure::broken(match found.len() {
                    0 => format!("This machine has no device {device}. See: banda devices list"),
                    _ => format!("More than one device is named {device}: remove it by its ID."),
                }));
            };
            ask(
                &mut client,
                "devices.remove",
                json!({ "device": one["id"] }),
            )
            .await?
        }
    };
    println!("{}", json!({ "ok": answer }));
    Ok(())
}

async fn ask(client: &mut Client, method: &str, params: Value) -> Result<Value, Failure> {
    client.call(method, None, CommandId::new(), params).await
}
