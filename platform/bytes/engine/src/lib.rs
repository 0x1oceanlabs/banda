//! The bytes module (ADR 0106, step 4a; ADR 0082, decision 13): a file's
//! bytes, and a page shown in a frame, served by this machine's engine
//! beside its API, so a window on any device draws a Project's pictures,
//! videos, PDFs and pages from the machine that holds them.
//!
//! `bytes.issue` gives a window a token for a file as the Person reads it:
//! a path relative to the Project's folder or whole, anywhere on this
//! machine's own disks, as the kernel's path guard reads it for the Person
//! ([`Reach`]) and as the window's hosts gave links. No Agent is given
//! one. `GET /b/<token>` serves the file's bytes, in ranges;
//! `GET /p/<token>` serves a page into a frame alone, sandboxed, so it
//! runs on an origin of no one's and never opens the API, which any page
//! of this machine's may try.
//!
//! These are the window's byte host and sandbox host moved to the engine
//! as they were (`FileLinks` and `PreviewHost`, which step 4b took out of
//! the window's main process, which now relays both hosts here): a token
//! serves the one file it was given for, by its real path, device and
//! inode, for an hour. No link is followed as it is served, and another
//! file put in its place is not served. What a file is served as comes
//! from its extension (`kinds`).
//!
//! A token is 256 bits from the system's randomness, so none is guessed,
//! and it names nothing: the file it serves is kept only in the engine's
//! memory, so a restart ends every token too. No token is logged. Until
//! pairing binds a token to a device (H3), it is the capability: whoever
//! holds it reads its file.

mod file;
mod kinds;
mod range;
mod served;

pub use kinds::{PAGE_CSP, Use};

use banda_kernel::api::{self, Served};
use banda_kernel::host::on_this_machine;
use banda_kernel::{Call, Kind, Module, Participant, Reach, Refusal, Right};
use file::{Identity, Unpinned, pin, resolvable};
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use ts_rs::TS;

/// How long a token serves its file: an hour, as the window asks again
/// within it.
pub const HOUR: i64 = 60 * 60 * 1000;

/// The most tokens kept at once. Past it, the one that ends first goes
/// first, and its Pane asks again, as it does after an hour.
const MOST: usize = 65_536;

/// What `bytes.issue` asks.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bytes/")]
pub struct Issue {
    /// The file: relative to the Project's folder, or whole.
    pub path: String,
    /// What the token is for.
    #[serde(rename = "use")]
    pub used: Use,
}

/// A token, as `bytes.issue` gives it: for `/b/<token>`, or `/p/<token>`
/// for a page.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bytes/")]
pub struct Issued {
    pub token: String,
    /// When it stops serving its file, in ms since the epoch.
    #[ts(type = "number")]
    pub until: i64,
}

/// Its token is the capability, so no log, panic or test says it.
impl std::fmt::Debug for Issued {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        (f.debug_struct("Issued"))
            .field("token", &"…")
            .field("until", &self.until)
            .finish()
    }
}

/// The file a token serves, as it was when the token was given.
#[derive(Clone)]
struct Claim {
    /// Whole, and its own real path.
    path: PathBuf,
    id: Identity,
    until: i64,
    used: Use,
}

/// The tokens given out, each with its file.
struct Claims {
    given: HashMap<String, Claim>,
    most: usize,
}

impl Claims {
    fn new(most: usize) -> Claims {
        Claims {
            given: HashMap::new(),
            most,
        }
    }

    /// Keeps `claim` under `token`: past the most, those ended go first,
    /// then the one that ends first.
    fn keep(&mut self, token: String, claim: Claim, now: i64) {
        if self.given.len() >= self.most {
            self.given.retain(|_, claim| now < claim.until);
        }
        if self.given.len() >= self.most {
            let first = (self.given.iter())
                .min_by_key(|(_, claim)| claim.until)
                .map(|(token, _)| token.clone());
            if let Some(first) = first {
                self.given.remove(&first);
            }
        }
        self.given.insert(token, claim);
    }

    /// The claim `token` holds, while it lasts, when it is for `served`.
    fn claim(&mut self, token: &str, served: Served, now: i64) -> Option<Claim> {
        let claim = self.given.get(token)?;
        if now >= claim.until {
            self.given.remove(token);
            return None;
        }
        (claim.used.served() == served).then(|| claim.clone())
    }
}

/// The clock tokens are given and served by: ms since the epoch.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// The bytes module, and what answers its routes beside the API: one,
/// cloned, shares its tokens.
#[derive(Clone)]
pub struct Bytes {
    claims: Arc<Mutex<Claims>>,
    clock: Clock,
}

impl Default for Bytes {
    fn default() -> Self {
        Self::new()
    }
}

impl Bytes {
    pub fn new() -> Self {
        Self::on_clock(Arc::new(banda_kernel::now_ms))
    }

    /// Tokens given and served by `clock`, as a test moves it.
    pub fn on_clock(clock: Clock) -> Self {
        Bytes {
            claims: Arc::new(Mutex::new(Claims::new(MOST))),
            clock,
        }
    }

    async fn issue(&self, call: Call, ask: Issue) -> Result<Issued, Refusal> {
        // The window's hosts gave a link to the window alone. An Agent
        // reads a file through Files, which keeps it inside its Project
        // as it opens the file; the routes, outside the fence, would not.
        if let Participant::Agent(_) = call.participant() {
            return Err(Refusal::forbidden(
                "A token for a file's bytes is for a window to draw it: an Agent reads a file with files.read.",
            ));
        }
        let folder = call.project().folder();
        let now = (self.clock)();
        let claim = tokio::task::spawn_blocking(move || claim_of(&folder, &ask, now))
            .await
            .map_err(|_| Refusal::internal())??;
        let token = banda_kernel::secret().map_err(|_| Refusal::internal())?;
        let until = claim.until;
        self.claims.lock().unwrap().keep(token.clone(), claim, now);
        Ok(Issued { token, until })
    }
}

impl Bytes {
    /// A token for the page a module keeps at `path` and shows a window,
    /// as agents keeps a Visual's (ADR 0106, decision 6): served at
    /// `/p/<token>` as `bytes.issue`'s pages are, that file as it is now,
    /// for an hour. The module answers for who asks it: no Agent is given
    /// one.
    pub async fn page(&self, path: PathBuf) -> Result<Issued, Refusal> {
        let now = (self.clock)();
        let claim = tokio::task::spawn_blocking(move || {
            let gone = || Refusal::not_found("That page is not there.");
            let path = dunce::canonicalize(&path).map_err(|_| gone())?;
            if Use::Page.kind_of(&path).is_none() {
                return Err(gone());
            }
            let pinned = pin(&path).map_err(|_| gone())?;
            Ok(Claim {
                path,
                id: pinned.id,
                until: now + HOUR,
                used: Use::Page,
            })
        })
        .await
        .map_err(|_| Refusal::internal())??;
        let token = banda_kernel::secret().map_err(|_| Refusal::internal())?;
        let until = claim.until;
        self.claims.lock().unwrap().keep(token.clone(), claim, now);
        Ok(Issued { token, until })
    }
}

/// The claim on `ask.path` of the Person's call in the Project at
/// `folder`, as the window's byte host made one: a path it looks at only
/// on this machine, of a kind the use serves, through a link only to a
/// file of the kind it names, and a file.
fn claim_of(folder: &Path, ask: &Issue, now: i64) -> Result<Claim, Refusal> {
    let Issue { path: asked, used } = ask;
    let used = *used;
    let elsewhere = || {
        Refusal::invalid(format!(
            "{asked:?} names no file on this machine: a path starts at the Project's folder \
             or is whole, never at home, on the network or with a scheme."
        ))
    };
    // Refused before the disk is looked at: a look at a share would send
    // the Person's NTLM hash to its host.
    let whole = folder.join(asked);
    if !resolvable(asked) || !on_this_machine(&whole) {
        return Err(elsewhere());
    }
    let Some(kind) = used.kind_of(&whole) else {
        return Err(not_served(asked, used));
    };
    // Its links followed once, now, as `realpath` did: the token serves
    // the file they lead to, and never follows one again.
    let path = Reach::resolve(folder, asked, false)?.into_path();
    if !on_this_machine(&path) {
        return Err(elsewhere());
    }
    // A link may not make a picture of a file of another kind, nor serve
    // one its use does not.
    let real = used.kind_of(&path);
    if real.is_none() || (used == Use::Media && real != Some(kind)) {
        return Err(not_served(asked, used));
    }
    let pinned = pin(&path).map_err(|why| unpinned(asked, why))?;
    Ok(Claim {
        path,
        id: pinned.id,
        until: now + HOUR,
        used,
    })
}

/// A refusal of a file its use does not serve: a page or a picture alone,
/// as any file is served as bytes.
fn not_served(asked: &str, used: Use) -> Refusal {
    Refusal::invalid(match used {
        Use::Page => format!("{asked} is no page: a frame shows HTML and SVG alone."),
        _ => format!("{asked} is no picture, video nor sound, which alone a reply's path shows."),
    })
}

/// A refusal of a path where no file is served.
fn unpinned(asked: &str, why: Unpinned) -> Refusal {
    match why {
        Unpinned::Missing => Refusal::not_found(format!("{asked} is not there.")),
        Unpinned::NoFile => Refusal::invalid(format!("{asked} is no file.")),
        Unpinned::Moved => Refusal::not_found(format!("{asked} moved as it was asked for.")),
        Unpinned::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            Refusal::forbidden(format!("{asked} may not be read."))
        }
        Unpinned::Io(error) => Refusal::invalid(format!("{asked} could not be read: {error}.")),
    }
}

banda_kernel::methods! {
    Bytes(Call) as "BytesMethods" in "bytes/" {
        /// A token for a window to draw the file at `path` in the Project
        /// with, relative to its folder or whole, as the Person reads it;
        /// an Agent is given none. `file` serves any file's bytes at
        /// `/b/<token>`, and `media` a picture's, a video's or a sound's
        /// alone; `page` serves an HTML or SVG page at `/p/<token>`, into
        /// a frame alone and sandboxed. The token serves that file, as it
        /// is now, until `until`, an hour.
        call issue(Issue) -> Issued, Read;
    }
}

#[async_trait::async_trait]
impl Module for Bytes {
    fn name(&self) -> &'static str {
        "bytes"
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
}

impl api::Bytes for Bytes {
    fn serve(
        &self,
        served: Served,
        token: String,
        request: axum::extract::Request,
    ) -> BoxFuture<'static, axum::response::Response> {
        let bytes = self.clone();
        Box::pin(async move { bytes.answer(served, &token, request).await })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claim(until: i64, used: Use) -> Claim {
        Claim {
            path: PathBuf::from("/a.png"),
            id: (1, 2),
            until,
            used,
        }
    }

    #[test]
    fn a_token_serves_its_route_alone_and_only_till_its_hour_ends() {
        let mut claims = Claims::new(MOST);
        claims.keep("page".to_owned(), claim(100, Use::Page), 0);
        claims.keep("file".to_owned(), claim(100, Use::File), 0);
        claims.keep("media".to_owned(), claim(100, Use::Media), 0);
        assert!(claims.claim("page", Served::Page, 99).is_some());
        assert!(claims.claim("page", Served::Bytes, 99).is_none());
        assert!(claims.claim("file", Served::Bytes, 99).is_some());
        assert!(claims.claim("media", Served::Bytes, 99).is_some());
        assert!(claims.claim("media", Served::Page, 99).is_none());
        assert!(claims.claim("other", Served::Bytes, 99).is_none());
        // Ended, it goes.
        assert!(claims.claim("file", Served::Bytes, 100).is_none());
        assert!(!claims.given.contains_key("file"));
    }

    #[test]
    fn past_the_most_those_ended_go_then_the_one_that_ends_first() {
        let mut claims = Claims::new(3);
        claims.keep("a".to_owned(), claim(10, Use::File), 0);
        claims.keep("b".to_owned(), claim(30, Use::File), 0);
        claims.keep("c".to_owned(), claim(20, Use::File), 0);
        claims.keep("d".to_owned(), claim(40, Use::File), 0);
        let mut kept: Vec<&String> = claims.given.keys().collect();
        kept.sort();
        assert_eq!(kept, ["b", "c", "d"]);
        claims.keep("e".to_owned(), claim(50, Use::File), 35);
        let mut kept: Vec<&String> = claims.given.keys().collect();
        kept.sort();
        assert_eq!(kept, ["d", "e"], "b and c had ended");
    }

    #[test]
    fn no_token_is_said_in_debug() {
        let issued = Issued {
            token: "a5e".repeat(20),
            until: 7,
        };
        let said = format!("{issued:?}");
        assert!(!said.contains("a5e"), "{said}");
        assert!(said.contains('7'), "{said}");
    }
}
