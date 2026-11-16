//! A push to a device that is not looking (ADR 0081, decision 6; ADR 0124,
//! decision 10): Web Push, straight from this machine to the push service
//! the device's browser named, with no Banda Cloud between.
//!
//! A device that wants pushes says where they go ([`Subscription`]): the
//! push service's address for it, the two keys its browser made, and the
//! key a push to it is signed with. This machine keeps them in
//! `push.json` in the engine's state, by device, and says them to no one:
//! `devices.list` has none of it.
//!
//! What is pushed is sealed to the device's keys (RFC 8291, `aes128gcm`),
//! so the push service carries a blob; and the request is signed with the
//! device's push key (VAPID, RFC 8292), an ECDSA P-256 key the device made
//! and named as it subscribed. A browser has one subscription, under one
//! such key, and the machines are peers: so the key is the device's, and
//! it hands the same subscription to each machine that may push to it. A
//! push service that says the device is gone (404, 410) has its
//! subscription forgotten.

use banda_kernel::{DeviceId, Refusal};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::{SecureRandom as _, SystemRandom};
use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair};
use ring::{aead, agreement, hmac};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use ts_rs::TS;

/// The subscriptions' file in the engine's state.
const PUSH: &str = "push.json";

/// How long a push service keeps a push for a device it cannot reach, in
/// seconds: a call an hour old is read in the list, not in a push.
const KEPT_FOR: u32 = 60 * 60;

/// How long the signature of one request holds, in seconds.
const SIGNED_FOR: i64 = 12 * 60 * 60;

/// The most a push holds, sealed: what every push service takes.
const MOST: usize = 4096;

/// Where a device's pushes go, as its browser's `PushSubscription` says.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema, TS)]
#[ts(export, export_to = "devices/")]
pub struct Subscription {
    /// The push service's address for this device, `https://…`.
    pub endpoint: String,
    /// The device's public key for pushes: P-256, uncompressed, as
    /// base64url.
    pub p256dh: String,
    /// Its authentication secret: 16 bytes, as base64url.
    pub auth: String,
    /// The device's push key, public, which its browser named as it
    /// subscribed (`applicationServerKey`): P-256, uncompressed, as
    /// base64url.
    pub key: String,
    /// That key's private half, which signs each push to this device: 32
    /// bytes, as base64url.
    pub signs: String,
}

/// What a push says, as the device's service worker reads it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "devices/")]
pub struct Pushed {
    pub title: String,
    /// The line under the title.
    pub body: String,
    /// What it tells of: a later push with the same tag takes its place.
    pub tag: String,
    /// Where a tap goes, as an address in the page, `./#go/<what>`: none
    /// for the page as it opens.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub to: Option<String>,
}

/// The devices' subscriptions.
pub(crate) struct Pushes {
    file: PathBuf,
    kept: Mutex<BTreeMap<DeviceId, Subscription>>,
}

impl Pushes {
    /// Reads the subscriptions from `state`. A file that does not read is
    /// put aside: the devices subscribe again.
    pub(crate) fn open(state: &Path) -> std::io::Result<Pushes> {
        let file = state.join(PUSH);
        let kept = match std::fs::read(&file) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                tracing::warn!(%error, "the push subscriptions do not read: they are put aside");
                let _ = std::fs::rename(&file, file.with_extension("unread"));
                BTreeMap::new()
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(error),
        };
        Ok(Pushes {
            file,
            kept: Mutex::new(kept),
        })
    }

    /// Keeps where `device`'s pushes go, or with none forgets it.
    pub(crate) fn keep(
        &self,
        device: DeviceId,
        subscription: Option<Subscription>,
    ) -> Result<(), Refusal> {
        if let Some(subscription) = &subscription {
            read(subscription)?;
        }
        let mut kept = self.kept.lock().unwrap();
        let mut next = kept.clone();
        match subscription {
            Some(subscription) => next.insert(device, subscription),
            None => next.remove(&device),
        };
        if next != *kept {
            let bytes = serde_json::to_vec_pretty(&next).map_err(crate::internal)?;
            banda_kernel::host::write_private(&self.file, &bytes).map_err(crate::internal)?;
            *kept = next;
        }
        Ok(())
    }

    /// Whether `device` takes pushes from this machine.
    #[cfg(test)]
    pub(crate) fn has(&self, device: DeviceId) -> bool {
        self.kept.lock().unwrap().contains_key(&device)
    }

    /// The devices that take pushes, each with where they go.
    pub(crate) fn all(&self) -> Vec<(DeviceId, Subscription)> {
        let kept = self.kept.lock().unwrap();
        kept.iter().map(|(id, sub)| (*id, sub.clone())).collect()
    }

    /// Pushes `pushed` to `device`, and says whether its push service took
    /// it. A service that says the device is gone has it forgotten.
    pub(crate) async fn push(&self, device: DeviceId, pushed: &Pushed) -> Result<(), Refusal> {
        let subscription = (self.kept.lock().unwrap().get(&device).cloned())
            .ok_or_else(|| Refusal::not_found("This device takes no pushes from this machine."))?;
        let Keys {
            public,
            auth,
            signs,
        } = read(&subscription)?;
        let plain = serde_json::to_vec(pushed).map_err(crate::internal)?;
        let body = seal(&public, &auth, &plain).map_err(crate::internal)?;
        let signed = signed(&subscription, &signs, banda_kernel::now_ms() / 1000)
            .map_err(crate::internal)?;
        let client = banda_kernel::https::client().map_err(crate::internal)?;
        let sent = client
            .post(&subscription.endpoint)
            .header("authorization", signed)
            .header("content-encoding", "aes128gcm")
            .header("content-type", "application/octet-stream")
            .header("ttl", KEPT_FOR.to_string())
            .header("urgency", "high")
            .body(body)
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(%error, "a push did not reach its push service");
                Refusal::conflict("The push service could not be reached: try again.")
            })?;
        let status = sent.status();
        if status.is_success() {
            return Ok(());
        }
        if matches!(status.as_u16(), 404 | 410) {
            let _ = self.keep(device, None);
            return Err(Refusal::not_found(
                "The push service says this device takes pushes no more: turn them on again there.",
            ));
        }
        tracing::warn!(%status, "a push service refused a push");
        Err(Refusal::conflict(format!(
            "The push service refused the push ({status})."
        )))
    }
}

/// The `Authorization` header of a push to `subscription` at `now`
/// seconds: a token the device's push key signed (RFC 8292).
fn signed(subscription: &Subscription, signs: &EcdsaKeyPair, now: i64) -> Result<String, String> {
    let audience = origin(&subscription.endpoint).ok_or("the endpoint has no origin")?;
    let part = |json: serde_json::Value| URL_SAFE_NO_PAD.encode(json.to_string());
    let token = format!(
        "{}.{}",
        part(serde_json::json!({ "typ": "JWT", "alg": "ES256" })),
        part(serde_json::json!({
            "aud": audience,
            "exp": now + SIGNED_FOR,
            // Whom the push service may write to about this sender.
            "sub": "https://banda.so",
        })),
    );
    let signature =
        (signs.sign(&SystemRandom::new(), token.as_bytes())).map_err(|error| error.to_string())?;
    Ok(format!(
        "vapid t={token}.{}, k={}",
        URL_SAFE_NO_PAD.encode(signature.as_ref()),
        subscription.key.trim_end_matches('=')
    ))
}

/// The scheme and host of `endpoint`, an `https://` address.
fn origin(endpoint: &str) -> Option<&str> {
    let rest = endpoint.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?;
    (!host.is_empty() && !host.contains('@')).then(|| &endpoint[.."https://".len() + host.len()])
}

/// A subscription's keys, read.
struct Keys {
    /// The device's public key for pushes.
    public: Vec<u8>,
    auth: Vec<u8>,
    /// Its push key, which signs.
    signs: EcdsaKeyPair,
}

/// A subscription's keys; or why it is none.
fn read(subscription: &Subscription) -> Result<Keys, Refusal> {
    let bytes = |text: &str| URL_SAFE_NO_PAD.decode(text.trim_end_matches('=')).ok();
    let none = || {
        Refusal::invalid(
            "A push subscription has an https endpoint, a P-256 public key and a 16-byte secret, as the browser gives them, and the P-256 key pair it was made under.",
        )
    };
    let public = bytes(&subscription.p256dh).ok_or_else(none)?;
    let auth = bytes(&subscription.auth).ok_or_else(none)?;
    let whole = public.len() == 65
        && public[0] == 4
        && auth.len() == 16
        && subscription.endpoint.len() <= 2048
        && origin(&subscription.endpoint).is_some();
    if !whole {
        return Err(none());
    }
    let key = bytes(&subscription.key).ok_or_else(none)?;
    let signs = bytes(&subscription.signs).ok_or_else(none)?;
    // Refuses a private half that is not the public one's.
    let signs = EcdsaKeyPair::from_private_key_and_public_key(
        &ECDSA_P256_SHA256_FIXED_SIGNING,
        &signs,
        &key,
        &SystemRandom::new(),
    )
    .map_err(|_| none())?;
    Ok(Keys {
        public,
        auth,
        signs,
    })
}

/// `plain`, sealed to a device's keys (RFC 8291): a key pair and a salt
/// made for this one push, then [`sealed`].
fn seal(ua_public: &[u8], auth: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let unspecified = |_| "the push could not be sealed".to_owned();
    let rng = SystemRandom::new();
    let mut salt = [0u8; 16];
    rng.fill(&mut salt).map_err(unspecified)?;
    let ours = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng)
        .map_err(unspecified)?;
    let as_public = ours.compute_public_key().map_err(unspecified)?;
    let theirs = agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, ua_public);
    agreement::agree_ephemeral(ours, &theirs, |secret| {
        sealed(ua_public, auth, &salt, as_public.as_ref(), secret, plain)
    })
    .map_err(unspecified)?
}

/// The body of a push (RFC 8291, section 3.4; RFC 8188): the header, then
/// `plain` and its one delimiter, encrypted under the key the shared
/// secret, the device's secret and the salt give.
fn sealed(
    ua_public: &[u8],
    auth: &[u8],
    salt: &[u8; 16],
    as_public: &[u8],
    ecdh_secret: &[u8],
    plain: &[u8],
) -> Result<Vec<u8>, String> {
    let mac = |key: &[u8], parts: &[&[u8]]| {
        let mut signing = hmac::Context::with_key(&hmac::Key::new(hmac::HMAC_SHA256, key));
        parts.iter().for_each(|part| signing.update(part));
        signing.sign()
    };
    let prk_key = mac(auth, &[ecdh_secret]);
    let ikm = mac(
        prk_key.as_ref(),
        &[b"WebPush: info\0", ua_public, as_public, &[1]],
    );
    let prk = mac(salt, &[ikm.as_ref()]);
    let cek = mac(prk.as_ref(), &[b"Content-Encoding: aes128gcm\0", &[1]]);
    let nonce = mac(prk.as_ref(), &[b"Content-Encoding: nonce\0", &[1]]);

    let key = aead::UnboundKey::new(&aead::AES_128_GCM, &cek.as_ref()[..16])
        .map_err(|error| error.to_string())?;
    let nonce = aead::Nonce::try_assume_unique_for_key(&nonce.as_ref()[..12])
        .map_err(|error| error.to_string())?;
    // One record, the last: its delimiter is 2.
    let mut record = [plain, &[2]].concat();
    aead::LessSafeKey::new(key)
        .seal_in_place_append_tag(nonce, aead::Aad::empty(), &mut record)
        .map_err(|error| error.to_string())?;

    let mut body = Vec::with_capacity(21 + as_public.len() + record.len());
    body.extend_from_slice(salt);
    body.extend_from_slice(&(MOST as u32).to_be_bytes());
    body.push(as_public.len() as u8);
    body.extend_from_slice(as_public);
    body.extend_from_slice(&record);
    if body.len() > MOST {
        return Err("the push is longer than a push service takes".to_owned());
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{ECDSA_P256_SHA256_FIXED, UnparsedPublicKey};

    fn bytes(text: &str) -> Vec<u8> {
        URL_SAFE_NO_PAD.decode(text).unwrap()
    }

    /// RFC 8291, section 5 and appendix A.
    #[test]
    fn a_push_is_sealed_as_the_rfc_s_example_is() {
        let ua_public = bytes(
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        );
        let as_public = bytes(
            "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
        );
        let salt: [u8; 16] = bytes("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap();
        let body = sealed(
            &ua_public,
            &bytes("BTBZMqHH6r4Tts7J_aSIgg"),
            &salt,
            &as_public,
            &bytes("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"),
            b"When I grow up, I want to be a watermelon",
        )
        .unwrap();
        let header = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
        let cipher =
            "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ";
        assert_eq!(body, [bytes(header), bytes(cipher)].concat());
    }

    #[test]
    fn a_push_is_sealed_to_a_key_made_for_it_alone() {
        let rng = SystemRandom::new();
        let device = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng).unwrap();
        let ua_public = device.compute_public_key().unwrap();
        let one = seal(ua_public.as_ref(), &[7; 16], b"hello").unwrap();
        let other = seal(ua_public.as_ref(), &[7; 16], b"hello").unwrap();
        // salt, record size, key length, key, then the text, its
        // delimiter and the tag.
        assert_eq!(one.len(), 16 + 4 + 1 + 65 + 5 + 1 + 16);
        assert_ne!(one, other);
    }

    /// A subscription under a push key made here, as a device makes
    /// one.
    fn subscription(endpoint: &str) -> Subscription {
        let rng = SystemRandom::new();
        let made = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng).unwrap();
        // PKCS#8 of a P-256 key, as ring writes it: the private half at
        // 36, the public one last.
        let (signs, key) = (
            &made.as_ref()[36..68],
            &made.as_ref()[made.as_ref().len() - 65..],
        );
        Subscription {
            endpoint: endpoint.to_owned(),
            p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4".to_owned(),
            auth: "BTBZMqHH6r4Tts7J_aSIgg".to_owned(),
            key: URL_SAFE_NO_PAD.encode(key),
            signs: URL_SAFE_NO_PAD.encode(signs),
        }
    }

    #[test]
    fn a_push_is_signed_with_the_device_s_push_key_for_the_push_service_alone() {
        let subscription = subscription("https://web.push.apple.com/QGk3?x=1");
        let keys = read(&subscription).unwrap();
        let signed = signed(&subscription, &keys.signs, 1_000).unwrap();
        let (token, key) = signed
            .strip_prefix("vapid t=")
            .and_then(|rest| rest.split_once(", k="))
            .unwrap();
        assert_eq!(key, subscription.key);
        let (said, signature) = token.rsplit_once('.').unwrap();
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, bytes(key))
            .verify(said.as_bytes(), &bytes(signature))
            .unwrap();
        let claims: serde_json::Value =
            serde_json::from_slice(&bytes(said.split_once('.').unwrap().1)).unwrap();
        assert_eq!(claims["aud"], "https://web.push.apple.com");
        assert_eq!(claims["exp"], 1_000 + SIGNED_FOR);
    }

    #[test]
    fn a_subscription_is_kept_by_device_and_one_that_is_none_is_refused() {
        let state = tempfile::tempdir().unwrap();
        let pushes = Pushes::open(state.path()).unwrap();
        let device = DeviceId::new();
        for endpoint in [
            "http://push.example/1",
            "https:///1",
            "https://a@b/1",
            "file:///x",
        ] {
            assert!(pushes.keep(device, Some(subscription(endpoint))).is_err());
        }
        let mut short = subscription("https://push.example/1");
        short.auth = "BTBZ".to_owned();
        assert!(pushes.keep(device, Some(short)).is_err());

        // A private half that is another key's.
        let mut other = subscription("https://push.example/1");
        other.signs = subscription("https://push.example/1").signs;
        assert!(pushes.keep(device, Some(other)).is_err());

        pushes
            .keep(device, Some(subscription("https://push.example/1")))
            .unwrap();
        assert!(Pushes::open(state.path()).unwrap().has(device));
        pushes.keep(device, None).unwrap();
        assert!(!Pushes::open(state.path()).unwrap().has(device));
    }
}
