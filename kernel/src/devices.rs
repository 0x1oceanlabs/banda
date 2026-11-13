//! The door (ADR 0124): where one of the Person's devices comes into this
//! engine by its own key, over any pipe: loopback, a tailnet, an ssh
//! tunnel. It is a second way in beside the API ([`crate::api`]), which
//! stays for the programs on this machine, the CLI and the Agents, with
//! the owner's secret and their passes. The door takes neither: it has no
//! owner branch and no fallback to passes (ADR 0123, decision 1), so
//! nothing a network carries reaches the owner's secret.
//!
//! Both ends prove a key on each connection, and no session token is kept:
//!
//! 1. The door speaks first: a `challenge` with a nonce of its own, the
//!    host key, the time and the protocols it speaks, signed by the host
//!    key.
//! 2. The client answers `hello` with the range of protocols it speaks,
//!    its device's ID, a nonce of its own, and its device key's signature
//!    over the door's nonce, the host key, the origin its page came from
//!    and its own nonce. The door's nonce is used once, so a `hello` heard
//!    on one connection opens no other; the host key keeps it from being
//!    carried to another machine; the origin keeps a page elsewhere from
//!    using the device's key.
//! 3. The door answers `welcome`, as the API does, with the protocol it
//!    picked, the host key, the device, and the host key's signature over
//!    the client's nonce: a pipe that only repeats an old challenge cannot
//!    make it, so none poses as this machine. Or it says `goodbye`:
//!    `forbidden` to a `hello` that does not prove a device this machine
//!    knows; to one that does, `revoked` when the machine removed the
//!    device, and `protocol` where the ranges do not meet. A `goodbye` to
//!    a `hello`, and the one that ends a session, is signed by the host
//!    key too, over that `hello` as the door heard it and the reason: a
//!    pipe that changed the `hello` on its way gets a `goodbye` its
//!    client does not take for the machine's word, and a device forgets
//!    a key or pairs again only on that word.
//!
//! After `welcome` the frames are the API's. A device's session acts as
//! the Person it was paired by, and every act of it names the device
//! ([`Caller::device`]). Removing a device ends its sessions at once, each
//! told `revoked` ([`Devices::removals`]).
//!
//! Keys, nonces and signatures go as base64url with no padding. What is
//! signed is text: a line that names the message, then its fields, each on
//! a line of its own, as they are sent.

use crate::access::Caller;
use crate::api;
use crate::{Code, DeviceId, Kernel, PROTOCOL, Participant, PersonId, Refusal, now_ms};
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures::{SinkExt, StreamExt};
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::watch;
use ts_rs::TS;

/// The protocols this engine speaks at its door. A client says the range
/// it speaks, and the door picks the newest both do.
pub const PROTOCOLS: Protocols = Protocols {
    min: PROTOCOL,
    max: PROTOCOL,
};

/// A device as this machine keeps it since it was paired.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Device {
    /// Its public key: Ed25519, 32 bytes. The private half never leaves
    /// the device.
    pub key: [u8; 32],
    /// The Person who paired it: a session it opens acts as them.
    pub person: PersonId,
    /// The origin of the page it paired from, where every session of it
    /// must come from; none for a program that has no page, as the CLI.
    pub origin: Option<String>,
    /// This machine removed it: it opens no session, and is told so, to
    /// pair again. Its record is kept for that, so only the device itself
    /// learns it.
    pub removed: bool,
}

/// The devices port (ADR 0124, decisions 1 and 6): this machine's host key
/// and the devices it paired, which the engine keeps in its state. The
/// kernel only asks: it makes no key and writes no record.
pub trait Devices: Send + Sync + 'static {
    /// The host key's public half: Ed25519, 32 bytes.
    fn host_key(&self) -> [u8; 32];
    /// `message`, signed with the host key: 64 bytes.
    fn sign(&self, message: &[u8]) -> [u8; 64];
    /// The device `id` as this machine keeps it; none for one it never
    /// paired.
    fn device(&self, id: DeviceId) -> Option<Device>;
    /// Says each time this machine removed a device: every session a
    /// device has open then asks whether it is still paired, and ends if
    /// not.
    fn removals(&self) -> watch::Receiver<u64>;
}

/// The door's first frame, before any of the client's.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum DoorFrame {
    Challenge {
        /// 32 random bytes, used for this connection alone.
        nonce: String,
        /// This machine's host key. A client that paired with it checks
        /// it is the one it knows before it answers.
        host_key: String,
        /// This machine's time, in ms since the epoch.
        #[ts(type = "number")]
        time: i64,
        /// The protocols this engine speaks: where a client speaks none
        /// of them, it knows which of the two is the older.
        protocol: Protocols,
        /// The host key's signature over the rest ([`challenge_message`]).
        sig: String,
    },
}

/// A device's first frame at the door, in answer to its challenge.
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum DeviceFrame {
    Hello {
        /// The protocols the client speaks; the door picks one.
        protocol: Protocols,
        device: DeviceId,
        /// Random bytes of the client's own, which the door's `welcome`
        /// signs.
        nonce: String,
        /// The device key's signature over the door's nonce, the host
        /// key, the origin and `nonce` ([`hello_message`]).
        sig: String,
    },
}

/// A range of protocol versions, both ends in it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Protocols {
    pub min: u32,
    pub max: u32,
}

/// What a `welcome` at the door says beyond the API's (ADR 0124, decision
/// 3): who the two ends proved to be.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Proved {
    /// This machine's host key.
    pub host_key: String,
    /// The device the session is.
    pub device: DeviceId,
    /// The host key's signature over the nonce of the device's `hello`
    /// and the device ([`welcome_message`]): a client checks it against
    /// the key it paired with.
    pub sig: String,
}

/// What a host key signs in a `challenge`.
pub fn challenge_message(nonce: &str, host_key: &str, time: i64, protocol: Protocols) -> String {
    let Protocols { min, max } = protocol;
    format!("banda-door/challenge/1\n{nonce}\n{host_key}\n{time}\n{min}\n{max}")
}

/// What a device key signs in a `hello`: the door's nonce, the host key it
/// answers, the origin of the page that asks, none as the empty line, and
/// the client's own nonce.
pub fn hello_message(door_nonce: &str, host_key: &str, origin: &str, nonce: &str) -> String {
    format!("banda-door/hello/1\n{door_nonce}\n{host_key}\n{origin}\n{nonce}")
}

/// What a host key signs in a `welcome`: the client's nonce, and the
/// device it welcomes.
pub fn welcome_message(nonce: &str, device: DeviceId) -> String {
    format!("banda-door/welcome/1\n{nonce}\n{device}")
}

/// What a host key signs in a `goodbye`: the `hello` it answers, as the
/// door heard it (its own nonce, the origin, the device, the client's
/// nonce, the protocols and the `hello`'s signature), then why, the code
/// and the words.
pub fn goodbye_message(
    door_nonce: &str,
    origin: &str,
    hello: &DeviceFrame,
    reason: &Refusal,
) -> String {
    let DeviceFrame::Hello {
        protocol: Protocols { min, max },
        device,
        nonce,
        sig,
    } = hello;
    let Refusal { code, message, .. } = reason;
    format!(
        "banda-door/goodbye/1\n{door_nonce}\n{origin}\n{device}\n{nonce}\n{min}\n{max}\n{sig}\n{code}\n{message}"
    )
}

/// Whether what a client chose, its nonce or its signature, can be signed
/// as one line of text.
fn fits(said: &str) -> bool {
    !said.is_empty() && said.len() <= 128 && said.bytes().all(|b| b.is_ascii_graphic())
}

struct Door {
    kernel: Arc<Kernel>,
    devices: Box<dyn Devices>,
    /// The host key, as every frame says it.
    host_key: String,
    engine: String,
}

/// The door's routes: one WebSocket at [`api::PATH`], for the devices
/// `devices` keeps.
pub fn router(kernel: Arc<Kernel>, devices: impl Devices, engine: impl Into<String>) -> Router {
    let door = Arc::new(Door {
        kernel,
        host_key: URL_SAFE_NO_PAD.encode(devices.host_key()),
        devices: Box::new(devices),
        engine: engine.into(),
    });
    Router::new()
        .route(api::PATH, get(upgrade))
        .with_state(door)
}

/// Any origin may come to the door: whose page it is counts once its
/// `hello` names a device, which is held to the origin it paired from.
/// One that cannot be read is no origin to hold a device to.
async fn upgrade(
    State(door): State<Arc<Door>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let origin = match headers.get(header::ORIGIN).map(|origin| origin.to_str()) {
        Some(Ok(origin)) => Some(origin.to_owned()),
        Some(Err(_)) => return StatusCode::FORBIDDEN.into_response(),
        None => None,
    };
    ws.on_upgrade(move |socket| serve(door, origin, socket))
}

async fn serve(door: Arc<Door>, origin: Option<String>, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let Ok(nonce) = crate::passes::random() else {
        return;
    };
    let nonce = URL_SAFE_NO_PAD.encode(nonce);
    let time = now_ms();
    let said = challenge_message(&nonce, &door.host_key, time, PROTOCOLS);
    let challenge = DoorFrame::Challenge {
        nonce: nonce.clone(),
        host_key: door.host_key.clone(),
        time,
        protocol: PROTOCOLS,
        sig: URL_SAFE_NO_PAD.encode(door.devices.sign(said.as_bytes())),
    };
    if sink.send(api::text(&challenge)).await.is_err() {
        return;
    }
    // Heard from before its record is read, so no removal is missed.
    let mut removals = door.devices.removals();
    // The API's `hello`, with the owner's secret or a pass, is none here.
    let hello = api::first::<DeviceFrame>(&mut stream).await;
    // What its `goodbye` is signed over, should it get one: none for a
    // `hello` that cannot be signed as text.
    let heard = hello
        .clone()
        .filter(|DeviceFrame::Hello { nonce, sig, .. }| fits(nonce) && fits(sig));
    let admitted = match hello {
        Some(hello) => admit(&door, &nonce, origin.as_deref(), hello),
        None => Err(Refusal::forbidden(
            "The first frame at the door must be hello, signed by a device this machine paired.",
        )),
    };
    let (caller, device, welcome) = match admitted {
        Ok(admitted) => admitted,
        Err(reason) => {
            let farewell = door.farewell(reason, &nonce, origin.as_deref(), heard.as_ref());
            return api::refuse(sink, farewell).await;
        }
    };
    let kernel = door.kernel.clone();
    let removed = async {
        loop {
            if removals.changed().await.is_err() {
                // What keeps the devices is gone: none is removed now.
                return std::future::pending().await;
            }
            if !(door.devices.device(device)).is_some_and(|device| !device.removed) {
                return door.farewell(revoked(), &nonce, origin.as_deref(), heard.as_ref());
            }
        }
    };
    api::session(kernel, &door.engine, caller, welcome, sink, stream, removed).await
}

impl Door {
    /// `reason` as this door's `goodbye` says it: signed by the host key
    /// over the `hello` it answers, as the door heard it on a connection
    /// it gave `door_nonce` from a page of `origin`, where it heard one.
    fn farewell(
        &self,
        reason: Refusal,
        door_nonce: &str,
        origin: Option<&str>,
        hello: Option<&DeviceFrame>,
    ) -> api::Farewell {
        let sig = hello.map(|hello| {
            let said = goodbye_message(door_nonce, origin.unwrap_or_default(), hello, &reason);
            URL_SAFE_NO_PAD.encode(self.devices.sign(said.as_bytes()))
        });
        api::Farewell { reason, sig }
    }
}

/// Who a `hello` is, the device its session is, and what its `welcome`
/// says of the door; or why it gets none. Only a `hello` that proves a
/// device this machine knows learns more than `forbidden`.
fn admit(
    door: &Door,
    door_nonce: &str,
    origin: Option<&str>,
    hello: DeviceFrame,
) -> Result<(Caller, DeviceId, api::Welcomed), Refusal> {
    let DeviceFrame::Hello {
        protocol,
        device,
        nonce,
        sig,
    } = hello;
    let forbidden =
        || Refusal::forbidden("This machine has not paired this device, or its key does not fit.");
    let paired = door.devices.device(device).ok_or_else(forbidden)?;
    if !fits(&nonce) || paired.origin.as_deref() != origin {
        return Err(forbidden());
    }
    let message = hello_message(
        door_nonce,
        &door.host_key,
        origin.unwrap_or_default(),
        &nonce,
    );
    let sig = URL_SAFE_NO_PAD.decode(sig).map_err(|_| forbidden())?;
    UnparsedPublicKey::new(&ED25519, paired.key)
        .verify(message.as_bytes(), &sig)
        .map_err(|_| forbidden())?;
    if paired.removed {
        return Err(revoked());
    }
    let welcome = api::Welcomed {
        protocol: pick(protocol)?,
        door: Some(Proved {
            host_key: door.host_key.clone(),
            device,
            sig: URL_SAFE_NO_PAD.encode(
                door.devices
                    .sign(welcome_message(&nonce, device).as_bytes()),
            ),
        }),
    };
    let caller = Caller::from(Participant::Person(paired.person)).on(device);
    Ok((caller, device, welcome))
}

/// The newest protocol both this engine and a client that speaks `theirs`
/// speak.
fn pick(theirs: Protocols) -> Result<u32, Refusal> {
    let newest = theirs.max.min(PROTOCOLS.max);
    if theirs.min <= theirs.max && newest >= theirs.min.max(PROTOCOLS.min) {
        return Ok(newest);
    }
    Err(Refusal::new(
        Code::Protocol,
        format!(
            "This engine speaks protocol {PROTOCOL}, the device speaks {} to {}. Update Banda.",
            theirs.min, theirs.max
        ),
    ))
}

/// Why a device this machine removed gets no session, and loses the ones
/// it has.
fn revoked() -> Refusal {
    Refusal::new(
        Code::Revoked,
        "This device was removed from this machine. Pair it again.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_door_picks_the_newest_protocol_both_speak_or_says_which_it_speaks() {
        let range = |min, max| Protocols { min, max };
        assert_eq!(pick(range(PROTOCOL, PROTOCOL)).unwrap(), PROTOCOL);
        assert_eq!(pick(range(0, PROTOCOL + 5)).unwrap(), PROTOCOL);
        for none in [
            range(PROTOCOL + 1, PROTOCOL + 2),
            range(PROTOCOL, PROTOCOL - 1),
        ] {
            let refusal = pick(none).unwrap_err();
            assert_eq!(refusal.code, Code::Protocol);
            assert!(refusal.message.contains("Update Banda."), "{refusal:?}");
        }
    }
}
