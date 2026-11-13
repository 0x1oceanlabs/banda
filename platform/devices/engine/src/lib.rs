//! The devices module (ADR 0124, decisions 1, 5 and 6): this machine's
//! host key, and the devices it lets in at its door. A device is a
//! desktop's window, a browser, a phone or a CLI on another machine, known
//! by a key of its own whose private half never leaves it.
//!
//! Both are kept in the engine's state, readable only by its user: the
//! host key in `host.key`, made on first use, and the devices in
//! `devices.json`. [`Paired`] holds them while the engine runs, and is the
//! kernel's devices port, which its door asks on every connection; the
//! module's methods list, add and remove a device, as only the Person
//! does. A device removed keeps its record, marked, so it alone is told
//! `revoked`, and its sessions end at once.
//!
//! A device this machine has not paired asks at the door, and waits there
//! (decision 6). The askings are kept in memory only, a few at a time,
//! each for five minutes: `devices.asking` says them to every window that
//! is the Person here, each with the code its own screen shows, and
//! `devices.allow` pairs one, `devices.refuse` sends it away. An engine
//! that restarts forgets them: the device asks again.

use banda_kernel::api::APP_ORIGIN;
use banda_kernel::devices::{Asked, Asking, Device, Devices};
use banda_kernel::methods::Nothing;
use banda_kernel::{
    Call, DeviceId, Kind, Module, PersonId, Refusal, Right, Scope, Stream, now_ms, watching,
};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::{oneshot, watch};
use ts_rs::TS;

/// The host key's file in the engine's state: an Ed25519 key, as PKCS#8.
const HOST_KEY: &str = "host.key";

/// The devices' file in the engine's state.
const DEVICES: &str = "devices.json";

/// The most a device's name holds.
const NAME_MOST: usize = 64;

/// How many devices may ask to be paired at once: more are told to try
/// again, so whoever reaches the door fills no memory.
const ASKING_MOST: usize = 8;

/// How long an asking waits for the Person's answer, in ms.
const ASKING_FOR: i64 = 5 * 60 * 1000;

/// What kind of client a device is, for the Person who reads the list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "devices/")]
pub enum DeviceKind {
    /// Banda's window on a computer.
    Desktop,
    /// A tab of a browser.
    Browser,
    Phone,
    /// The `banda` CLI on another machine.
    Cli,
}

/// A device as this machine keeps it, and as `devices.list` says it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "devices/")]
pub struct PairedDevice {
    pub id: DeviceId,
    /// What the Person reads it by: "Roma's Mac".
    pub name: String,
    pub kind: DeviceKind,
    /// Its public key: Ed25519, 32 bytes, as base64url.
    pub key: String,
    /// The origin of the page it paired from; none for a program with no
    /// page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<String>,
    /// It is this machine's own window, which pairs itself as this
    /// machine's console does (ADR 0124, decision 6).
    #[serde(default)]
    pub here: bool,
    /// When it was paired, in ms since the epoch.
    #[ts(type = "number")]
    pub added_at: i64,
    /// The device whose session paired it; none for this machine's
    /// console, as `banda devices add`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub added_by: Option<DeviceId>,
    /// When this machine removed it; none while it is paired.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub removed_at: Option<i64>,
}

/// A device that asks to be paired, as `devices.asking` says it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "devices/")]
pub struct Ask {
    /// The code its own screen shows: the Person allows it only where
    /// the two are the same.
    pub code: String,
    /// What it says it is called.
    pub name: String,
    pub kind: DeviceKind,
    /// The origin of the page that asks; none for a program with no page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin: Option<String>,
    /// When it asked, in ms since the epoch.
    #[ts(type = "number")]
    pub asked_at: i64,
    /// When its time is out.
    #[ts(type = "number")]
    pub until: i64,
}

/// An asking as it waits: what the Person sees of it, the key it proved,
/// and who hears the answer at the door.
struct Waiting {
    ask: Ask,
    key: String,
    answer: oneshot::Sender<Option<DeviceId>>,
}

struct Kept {
    /// The devices that ask now, which the door keeps waiting.
    waiting: Mutex<Vec<Waiting>>,
    /// The same as the Person's windows hear them.
    asking: watch::Sender<Vec<Ask>>,
    host: Ed25519KeyPair,
    file: PathBuf,
    /// Who a device's session acts as: this machine's owner.
    owner: PersonId,
    /// The devices as the file has them: the door reads them on every
    /// connection, so a change is put here only once it is written.
    known: Mutex<Vec<PairedDevice>>,
    /// Held by one change at a time, across its write.
    changing: Mutex<()>,
    removals: watch::Sender<u64>,
}

/// This machine's host key and the devices it paired, as the engine holds
/// them while it runs: the kernel's devices port, and what the module's
/// methods change.
#[derive(Clone)]
pub struct Paired(Arc<Kept>);

impl Paired {
    /// Reads the host key and the devices from `state`, the engine's state
    /// folder, and makes the key on first use. A devices file that does
    /// not read is put aside, and the machine starts with none: its own
    /// window pairs itself again.
    pub fn open(state: &Path, owner: PersonId) -> std::io::Result<Paired> {
        let host = host_key(&state.join(HOST_KEY))?;
        let file = state.join(DEVICES);
        let known = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                tracing::warn!(%error, "the devices file does not read: it is put aside");
                let _ = std::fs::rename(&file, file.with_extension("unread"));
                Vec::new()
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error),
        };
        Ok(Paired(Arc::new(Kept {
            waiting: Mutex::new(Vec::new()),
            asking: watch::channel(Vec::new()).0,
            host,
            file,
            owner,
            known: Mutex::new(known),
            changing: Mutex::new(()),
            removals: watch::channel(0).0,
        })))
    }

    /// The host key's public half, as every frame of the door says it.
    pub fn host_key_text(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.host_key())
    }

    /// The devices paired now, the oldest first.
    fn listed(&self) -> Vec<PairedDevice> {
        let known = self.0.known.lock().unwrap();
        (known.iter().filter(|one| one.removed_at.is_none()))
            .cloned()
            .collect()
    }

    /// Pairs the device `add` describes, by `by`'s session, none for the
    /// console. One paired already by that key, from that origin, stays as
    /// it is, and is answered: a window that pairs itself again makes no
    /// second record.
    fn add(&self, add: Add, by: Option<DeviceId>) -> Result<PairedDevice, Refusal> {
        let name = add.name.trim();
        if name.is_empty() || name.chars().count() > NAME_MOST {
            return Err(Refusal::invalid(format!(
                "A device's name has 1 to {NAME_MOST} characters."
            )));
        }
        if !matches!(URL_SAFE_NO_PAD.decode(&add.key), Ok(key) if key.len() == 32) {
            return Err(Refusal::invalid(
                "A device's key is an Ed25519 public key: 32 bytes, as base64url.",
            ));
        }
        // Banda's window pairs from its own origin, whoever says it.
        let origin = match add.here {
            true => Some(APP_ORIGIN.to_owned()),
            false => add.origin,
        };
        let _changing = self.0.changing.lock().unwrap();
        let mut known = self.0.known.lock().unwrap().clone();
        let paired = |one: &&PairedDevice| one.removed_at.is_none() && one.key == add.key;
        if let Some(already) = known.iter().find(paired) {
            return match already.origin == origin {
                true => Ok(already.clone()),
                // Its sessions come from where it paired: another origin
                // is another device, which this key cannot be too.
                false => Err(Refusal::conflict(format!(
                    "This key is paired already, as {}. Remove that device first.",
                    already.name
                ))),
            };
        }
        let device = PairedDevice {
            id: DeviceId::new(),
            name: name.to_owned(),
            kind: add.kind,
            key: add.key,
            origin,
            here: add.here,
            added_at: now_ms(),
            added_by: by,
            removed_at: None,
        };
        known.push(device.clone());
        self.keep(known)?;
        Ok(device)
    }

    /// Removes `device`: its record stays, marked, and its sessions end.
    fn remove(&self, device: DeviceId) -> Result<(), Refusal> {
        let _changing = self.0.changing.lock().unwrap();
        let mut known = self.0.known.lock().unwrap().clone();
        let Some(one) = (known.iter_mut()).find(|one| one.id == device && one.removed_at.is_none())
        else {
            return Err(Refusal::not_found("This machine has no such device."));
        };
        one.removed_at = Some(now_ms());
        self.keep(known)?;
        self.0.removals.send_modify(|removed| *removed += 1);
        Ok(())
    }

    /// Lets go of each asking whose time is out, or whose device went
    /// from the door, and says what is left to who hears them.
    fn tidy(&self) {
        let now = now_ms();
        let mut waiting = self.0.waiting.lock().unwrap();
        waiting.retain(|one| one.ask.until > now && !one.answer.is_closed());
        let left: Vec<Ask> = waiting.iter().map(|one| one.ask.clone()).collect();
        self.0.asking.send_if_modified(|said| {
            let changed = *said != left;
            if changed {
                *said = left;
            }
            changed
        });
    }

    /// Takes the asking with `code` out, as the Person answers it; none
    /// with that code waits, as when its time ran out.
    fn answered(&self, code: &str) -> Result<Waiting, Refusal> {
        self.tidy();
        let code = typed(code);
        let mut waiting = self.0.waiting.lock().unwrap();
        let at = (waiting.iter().position(|one| one.ask.code == code)).ok_or_else(|| {
            Refusal::not_found("No device asks with this code now: its time may be out.")
        })?;
        Ok(waiting.remove(at))
    }

    /// Pairs the device that asks with `code`, by `by`'s session, and
    /// tells it at the door.
    fn allow(&self, code: &str, by: Option<DeviceId>) -> Result<PairedDevice, Refusal> {
        let Waiting { ask, key, answer } = self.answered(code)?;
        let add = Add {
            key,
            name: ask.name,
            kind: ask.kind,
            origin: ask.origin,
            here: false,
        };
        let paired = self.add(add, by);
        // Told either way: a device that was not paired asks again.
        let _ = answer.send(paired.as_ref().ok().map(|device| device.id));
        self.tidy();
        paired
    }

    /// Sends the device that asks with `code` away.
    fn refuse(&self, code: &str) -> Result<(), Refusal> {
        let _ = self.answered(code)?.answer.send(None);
        self.tidy();
        Ok(())
    }

    /// Writes the devices' file, whole, and only then has the door read
    /// them so: a change that was not kept is not made.
    fn keep(&self, known: Vec<PairedDevice>) -> Result<(), Refusal> {
        let bytes = serde_json::to_vec_pretty(&known).map_err(internal)?;
        banda_kernel::host::write_private(&self.0.file, &bytes).map_err(internal)?;
        *self.0.known.lock().unwrap() = known;
        Ok(())
    }
}

fn internal(error: impl std::fmt::Display) -> Refusal {
    tracing::error!(%error, "the devices were not kept");
    Refusal::internal()
}

/// The host key in `file`, made there on first use. One that does not
/// read is put aside and made again, so the engine starts all the same:
/// the machine is then another to its devices, which pair again.
fn host_key(file: &Path) -> std::io::Result<Ed25519KeyPair> {
    let other = |error: &dyn std::fmt::Display| std::io::Error::other(error.to_string());
    let read = |bytes: &[u8]| Ed25519KeyPair::from_pkcs8(bytes).map_err(|error| other(&error));
    match std::fs::read(file) {
        Ok(bytes) => match read(&bytes) {
            Ok(key) => return Ok(key),
            Err(error) => {
                tracing::warn!(%error, "the host key does not read: it is put aside, and made again");
                let _ = std::fs::rename(file, file.with_extension("unread"));
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let made =
        Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).map_err(|error| other(&error))?;
    banda_kernel::host::write_private(file, made.as_ref())?;
    read(made.as_ref())
}

impl Devices for Paired {
    fn host_key(&self) -> [u8; 32] {
        let key = self.0.host.public_key().as_ref();
        key.try_into().expect("an Ed25519 public key is 32 bytes")
    }

    fn sign(&self, message: &[u8]) -> [u8; 64] {
        let sig = self.0.host.sign(message);
        (sig.as_ref().try_into()).expect("an Ed25519 signature is 64 bytes")
    }

    fn device(&self, id: DeviceId) -> Option<Device> {
        let known = self.0.known.lock().unwrap();
        let one = known.iter().find(|one| one.id == id)?;
        let key = URL_SAFE_NO_PAD.decode(&one.key).ok()?.try_into().ok()?;
        Some(Device {
            key,
            person: self.0.owner,
            origin: one.origin.clone(),
            removed: one.removed_at.is_some(),
        })
    }

    fn removals(&self) -> watch::Receiver<u64> {
        self.0.removals.subscribe()
    }

    fn ask(&self, asking: Asking) -> Result<Asked, Refusal> {
        self.tidy();
        let invalid = || Refusal::invalid("A device is a desktop, a browser, a phone or a cli.");
        let kind = serde_json::from_value(Value::String(asking.kind)).map_err(|_| invalid())?;
        let key = URL_SAFE_NO_PAD.encode(asking.key);
        let now = now_ms();
        let until = now + ASKING_FOR;
        let (answer, heard) = oneshot::channel();
        {
            let mut waiting = self.0.waiting.lock().unwrap();
            // One device asks once: asked again, as from a page opened
            // anew, its older asking goes.
            waiting.retain(|one| one.key != key);
            if waiting.len() >= ASKING_MOST {
                return Err(Refusal::conflict(
                    "Too many devices ask to join this machine now. Try again in a few minutes.",
                ));
            }
            // A code names one asking: another key that came to the same
            // one asks again, on a new connection, for another.
            if waiting.iter().any(|one| one.ask.code == asking.code) {
                return Err(Refusal::conflict(
                    "Another device asks under this code now. Ask again.",
                ));
            }
            waiting.push(Waiting {
                ask: Ask {
                    code: asking.code,
                    name: asking.name,
                    kind,
                    origin: asking.origin,
                    asked_at: now,
                    until,
                },
                key,
                answer,
            });
        }
        self.tidy();
        Ok(Asked {
            until,
            answer: heard,
        })
    }

    fn left(&self, _code: &str) {
        // Its answer is let go of: it goes with the rest that went.
        self.tidy();
    }
}

/// A code as the Person typed it, as the door says them: in capitals,
/// with its dash, and each letter that reads as a digit taken for it.
fn typed(code: &str) -> String {
    let letters: String = code
        .chars()
        .filter(|letter| letter.is_ascii_alphanumeric())
        .map(|letter| match letter.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            letter => letter,
        })
        .collect();
    match letters.len() {
        8 => format!("{}-{}", &letters[..4], &letters[4..]),
        _ => letters,
    }
}

/// The devices module.
pub struct DevicesModule {
    paired: Paired,
}

impl DevicesModule {
    pub fn new(paired: Paired) -> Self {
        Self { paired }
    }
}

banda_kernel::methods! {
    DevicesModule(Call) as "DevicesMethods" in "devices/" {
        /// This machine's host key, and the devices it lets in at its
        /// door, the oldest first.
        call list(Nothing) -> Listed, Manage, read;
        /// Pairs a device by its public key, so it comes in at this
        /// machine's door as the Person. One whose key is paired already
        /// is answered as it is.
        command add(Add) -> PairedDevice, Manage;
        /// Removes a device: its sessions end at once, and it opens none
        /// until it is paired again.
        command remove(Remove) -> (), Manage;
        /// The devices that ask at the door to be paired now, then again
        /// as one asks, is answered or runs out of time: each with the
        /// code its own screen shows.
        stream asking(Nothing) -> Vec<Ask>, Manage, read;
        /// Pairs the device that asks with this code, so it comes in at
        /// this machine's door as the Person. Allow it only where its
        /// screen shows the same code.
        command allow(Answer) -> PairedDevice, Manage;
        /// Sends the device that asks with this code away.
        command refuse(Answer) -> (), Manage;
    }
}

/// The asking the Person answers, by its code.
#[derive(Debug, Deserialize, JsonSchema, TS)]
#[ts(export, export_to = "devices/")]
pub struct Answer {
    /// As both screens show it: `4F7K-92QD`.
    code: String,
}

/// What `devices.list` answers.
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "devices/")]
pub struct Listed {
    /// This machine's host key, public: Ed25519, as base64url.
    pub host_key: String,
    pub devices: Vec<PairedDevice>,
}

#[derive(Debug, Deserialize, JsonSchema, TS)]
#[ts(export, export_to = "devices/")]
pub struct Add {
    /// Its public key: Ed25519, 32 bytes, as base64url.
    key: String,
    /// What the Person reads it by.
    name: String,
    kind: DeviceKind,
    /// The origin of the page it pairs from; none for a program with no
    /// page.
    #[serde(default)]
    #[ts(optional)]
    origin: Option<String>,
    /// It is this machine's own window: it pairs from Banda's window's
    /// origin.
    #[serde(default)]
    #[ts(optional, as = "Option<bool>")]
    here: bool,
}

#[derive(Debug, Deserialize, JsonSchema, TS)]
#[ts(export, export_to = "devices/")]
pub struct Remove {
    device: DeviceId,
}

impl DevicesModule {
    async fn list(&self, _: Call, _: Nothing) -> Result<Listed, Refusal> {
        Ok(Listed {
            host_key: self.paired.host_key_text(),
            devices: self.paired.listed(),
        })
    }

    async fn add(&self, call: Call, add: Add) -> Result<PairedDevice, Refusal> {
        let (paired, by) = (self.paired.clone(), call.device());
        written(move || paired.add(add, by)).await
    }

    async fn remove(&self, _: Call, Remove { device }: Remove) -> Result<(), Refusal> {
        let paired = self.paired.clone();
        written(move || paired.remove(device)).await
    }

    async fn asking(&self, _: Call, _: Nothing) -> Result<Stream, Refusal> {
        self.paired.tidy();
        Ok(watching(self.paired.0.asking.subscribe()))
    }

    async fn allow(&self, call: Call, Answer { code }: Answer) -> Result<PairedDevice, Refusal> {
        let (paired, by) = (self.paired.clone(), call.device());
        written(move || paired.allow(&code, by)).await
    }

    async fn refuse(&self, _: Call, Answer { code }: Answer) -> Result<(), Refusal> {
        self.paired.refuse(&code)
    }
}

/// Runs a change that writes the devices' file where a wait for the disk
/// holds up no other call.
async fn written<T: Send + 'static>(
    change: impl FnOnce() -> Result<T, Refusal> + Send + 'static,
) -> Result<T, Refusal> {
    tokio::task::spawn_blocking(change)
        .await
        .map_err(internal)?
}

#[async_trait::async_trait]
impl Module for DevicesModule {
    fn name(&self) -> &'static str {
        "devices"
    }

    fn scope(&self) -> Scope {
        Scope::Machine
    }

    fn migrations(&self) -> &'static [&'static str] {
        &[]
    }

    fn right(&self, method: &str) -> Option<Right> {
        Self::method_right(method)
    }

    fn kind(&self, method: &str) -> Option<Kind> {
        Self::method_kind(method)
    }

    async fn call(&self, call: Call, method: &str, params: Value) -> Result<Value, Refusal> {
        self.dispatch(call, method, params).await
    }

    async fn stream(&self, call: Call, method: &str, params: Value) -> Result<Stream, Refusal> {
        self.dispatch_stream(call, method, params).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add(key: &str, name: &str) -> Add {
        Add {
            key: key.to_owned(),
            name: name.to_owned(),
            kind: DeviceKind::Phone,
            origin: Some("https://arc.example".to_owned()),
            here: false,
        }
    }

    /// A device's asking: its key `byte` over, named `name`, with `code`.
    fn asking(byte: u8, name: &str, code: &str) -> Asking {
        Asking {
            key: [byte; 32],
            name: name.to_owned(),
            kind: "browser".to_owned(),
            origin: Some("https://arc.example".to_owned()),
            code: code.to_owned(),
        }
    }

    #[tokio::test]
    async fn a_device_that_asks_waits_for_the_person_who_allows_it_by_its_code_or_refuses_it() {
        let state = tempfile::tempdir().unwrap();
        let paired = Paired::open(state.path(), PersonId::new()).unwrap();
        let heard = paired.0.asking.subscribe();
        let Asked { until, mut answer } = paired.ask(asking(1, "Safari", "4F7K-92QD")).unwrap();
        assert!(until > now_ms());
        // Every window that is the Person here hears it, with its code.
        let said = heard.borrow().clone();
        assert_eq!(said.len(), 1);
        assert_eq!(
            (said[0].code.as_str(), said[0].name.as_str(), said[0].kind),
            ("4F7K-92QD", "Safari", DeviceKind::Browser)
        );
        assert!(answer.try_recv().is_err());
        // Another code allows nothing; its own, as the Person types it,
        // pairs it from where it asked, and says who allowed it.
        let by = DeviceId::new();
        let none = paired.allow("0000-0000", Some(by)).unwrap_err();
        assert_eq!(none.code, banda_kernel::Code::NotFound);
        let device = paired.allow(" 4f7k-92qd ", Some(by)).unwrap();
        assert_eq!(answer.try_recv().unwrap(), Some(device.id));
        assert_eq!(device.name, "Safari");
        assert_eq!(device.origin.as_deref(), Some("https://arc.example"));
        assert_eq!(device.added_by, Some(by));
        assert_eq!(paired.device(device.id).unwrap().key, [1u8; 32]);
        assert!(heard.borrow().is_empty());
        // Allowed once: the code is no more.
        assert!(paired.allow("4F7K-92QD", None).is_err());

        // Refused, it hears so, and is not paired.
        let Asked { mut answer, .. } = paired.ask(asking(2, "iPhone", "AAAA-BBBB")).unwrap();
        paired.refuse("AAAA-BBBB").unwrap();
        assert_eq!(answer.try_recv().unwrap(), None);
        assert_eq!(paired.listed().len(), 1);
        assert!(heard.borrow().is_empty());
    }

    #[tokio::test]
    async fn only_a_few_devices_ask_at_once_each_once_under_a_code_of_its_own_and_one_that_left_makes_room()
     {
        let state = tempfile::tempdir().unwrap();
        let paired = Paired::open(state.path(), PersonId::new()).unwrap();
        let heard = paired.0.asking.subscribe();
        let mut waiting = Vec::new();
        for byte in 0..ASKING_MOST as u8 {
            let code = format!("AB12-{byte:04}");
            waiting.push(paired.ask(asking(byte, "one", &code)).unwrap());
        }
        let Err(full) = paired.ask(asking(99, "one more", "FE11-0000")) else {
            panic!("it keeps no more than a few");
        };
        assert_eq!(full.code, banda_kernel::Code::Conflict);
        // One that asks again takes its own place, under its new code.
        waiting.push(paired.ask(asking(0, "one", "AB12-AGA1")).unwrap());
        assert_eq!(heard.borrow().len(), ASKING_MOST);
        assert!(heard.borrow().iter().all(|one| one.code != "AB12-0000"));
        assert!(paired.allow("AB12-0000", None).is_err());
        // One that left the door is forgotten as the door says so, and
        // makes room for another.
        drop(waiting.remove(1));
        paired.left("AB12-0001");
        assert!(heard.borrow().iter().all(|one| one.code != "AB12-0001"));
        assert_eq!(heard.borrow().len(), ASKING_MOST - 1);
        // A code names one asking: another key under it asks again.
        let Err(taken) = paired.ask(asking(98, "another", "AB12-0003")) else {
            panic!("two devices never wait under one code");
        };
        assert_eq!(taken.code, banda_kernel::Code::Conflict);
        paired.ask(asking(99, "one more", "R00M-0000")).unwrap();
        assert!(heard.borrow().iter().any(|one| one.code == "R00M-0000"));
        // What is not a kind of device is not kept.
        let toaster = Asking {
            kind: "toaster".to_owned(),
            ..asking(50, "toaster", "T0AS-TER0")
        };
        assert!(paired.ask(toaster).is_err());
    }

    #[test]
    fn a_code_is_read_as_the_person_typed_it() {
        for said in ["4F7K-92QD", " 4f7k-92qd ", "4f7k92qd", "4F7K 92QD"] {
            assert_eq!(typed(said), "4F7K-92QD", "{said}");
        }
        // A letter that reads as a digit is that digit: the door says
        // neither O, I nor L.
        assert_eq!(typed("o0il-1234"), "0011-1234");
        // What is no code stays what it is, and finds nothing.
        assert_eq!(typed("4F7K"), "4F7K");
    }

    #[test]
    fn a_device_is_paired_by_a_key_and_a_name_that_fit_and_kept_as_it_was_removed() {
        let state = tempfile::tempdir().unwrap();
        let paired = Paired::open(state.path(), PersonId::new()).unwrap();
        let key = URL_SAFE_NO_PAD.encode([7u8; 32]);
        for (key, name) in [
            ("not a key", "iPhone"),
            (URL_SAFE_NO_PAD.encode([7u8; 31]).as_str(), "iPhone"),
            (key.as_str(), "  "),
            (key.as_str(), "x".repeat(NAME_MOST + 1).as_str()),
        ] {
            let refused = paired.add(add(key, name), None).unwrap_err();
            assert_eq!(refused.code, banda_kernel::Code::Invalid, "{key} {name}");
        }
        let phone = paired.add(add(&key, " iPhone "), None).unwrap();
        assert_eq!(phone.name, "iPhone");
        assert_eq!(phone.origin.as_deref(), Some("https://arc.example"));
        // Again from where it paired, it is the same device; from another
        // origin its key cannot be another too.
        assert_eq!(paired.add(add(&key, "iPhone"), None).unwrap().id, phone.id);
        let elsewhere = Add {
            here: true,
            ..add(&key, "This machine")
        };
        let taken = paired.add(elsewhere, None).unwrap_err();
        assert_eq!(taken.code, banda_kernel::Code::Conflict);
        let known = paired.device(phone.id).unwrap();
        assert_eq!((known.key, known.removed), ([7u8; 32], false));

        // Removed, its record says so, and it is paired no more: its key
        // pairs again as another device.
        let removals = paired.removals();
        paired.remove(phone.id).unwrap();
        assert!(removals.has_changed().unwrap());
        assert!(paired.device(phone.id).unwrap().removed);
        assert!(paired.listed().is_empty());
        let gone = paired.remove(phone.id).unwrap_err();
        assert_eq!(gone.code, banda_kernel::Code::NotFound);
        let again = paired.add(add(&key, "iPhone"), None).unwrap();
        assert_ne!(again.id, phone.id);

        // A new engine reads what the last kept.
        let reopened = Paired::open(state.path(), PersonId::new()).unwrap();
        assert_eq!(reopened.host_key(), paired.host_key());
        assert_eq!(reopened.listed(), [again]);
        assert!(reopened.device(phone.id).unwrap().removed);
    }

    #[test]
    fn a_file_that_does_not_read_is_put_aside_and_the_engine_starts_all_the_same() {
        let state = tempfile::tempdir().unwrap();
        let first = Paired::open(state.path(), PersonId::new()).unwrap();
        std::fs::write(state.path().join(DEVICES), "not json").unwrap();
        let next = Paired::open(state.path(), PersonId::new()).unwrap();
        assert!(next.listed().is_empty());
        assert_eq!(next.host_key(), first.host_key());
        assert!(state.path().join("devices.unread").exists());

        // A host key that does not read is made again: another machine to
        // its devices, which pair again.
        std::fs::write(state.path().join(HOST_KEY), "not a key").unwrap();
        let again = Paired::open(state.path(), PersonId::new()).unwrap();
        assert_ne!(again.host_key(), first.host_key());
        assert!(state.path().join("host.unread").exists());
    }
}
