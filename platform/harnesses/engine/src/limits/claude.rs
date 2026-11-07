//! Claude Code's limits (ADR 0043, decision 2): Anthropic's
//! `GET /api/oauth/usage`, asked with Claude Code's own access token. The
//! engine reads the token on its host, where Claude Code keeps it: in the
//! entry's configuration folder, or that folder's Keychain item on macOS.
//! No client reads it, as no client reads the host's disk (ADR 0062,
//! decision 3), so the limits read with no window open too.
//!
//! The token lives only in that one request: it is kept nowhere, written
//! in no log or Problem, sent nowhere but [`USAGE`], never renewed, and
//! never in what is kept. Claude Code renews its own sign-in as it runs.

use super::{Failure, Found, WAIT, instant, window};
use crate::Harness;
use crate::model::{LimitWindow, WindowKind};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// Where Claude Code's limits are read: the one place the token goes.
pub(crate) const USAGE: &str = "https://api.anthropic.com/api/oauth/usage";

/// How long Anthropic may take to answer, and the Keychain.
const ANSWERING: Duration = Duration::from_secs(10);

/// The variable that names Claude Code's configuration folder.
const CONFIG: &str = "CLAUDE_CONFIG_DIR";

const HOUR: i64 = 60 * 60 * 1000;

/// What Claude Code's sign-in says, and what Anthropic answered. It holds
/// no token.
#[derive(Debug, Default)]
struct Answer {
    /// Whether Claude Code keeps a sign-in.
    signed_in: bool,
    /// Its plan and tier, as the sign-in has them: `max`,
    /// `default_claude_max_20x`.
    subscription: Option<String>,
    tier: Option<String>,
    /// The address it is signed in with, from Claude Code's `.claude.json`.
    email: Option<String>,
    /// Its token expired, so Anthropic was not asked.
    expired: bool,
    status: Option<u16>,
    body: Option<Value>,
}

/// Where the engine asks for Claude Code's limits: Anthropic, or a test's
/// stand-in. Every read shares one client, made at the first.
#[derive(Clone)]
pub(crate) struct Anthropic {
    url: Arc<str>,
    client: Arc<OnceLock<reqwest::Client>>,
}

impl Anthropic {
    pub(crate) fn at(url: &str) -> Self {
        Self {
            url: url.into(),
            client: Arc::default(),
        }
    }

    /// The client: it follows no redirect, so the token goes to [`USAGE`]
    /// alone, and it goes through the system's proxy.
    fn client(&self) -> Result<reqwest::Client, Failure> {
        if let Some(client) = self.client.get() {
            return Ok(client.clone());
        }
        let made = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(format!("banda/{}", banda_kernel::version()))
            .build()
            .map_err(|e| Failure::new(format!("Banda's HTTPS did not start: {}.", cause(&e))))?;
        Ok(self.client.get_or_init(|| made).clone())
    }

    /// What Claude Code's sign-in in `place` says, and what Anthropic
    /// answered when asked with it, unless it had expired by `now`.
    async fn asked(&self, place: &Place, now: i64) -> Result<Answer, Failure> {
        let email = email_in(place);
        let login = match kept(place).await? {
            Some(kept) => Login::read(&kept).map_err(|e| {
                Failure::new(format!(
                    "Claude Code's sign-in does not read, at line {} column {}.",
                    e.line(),
                    e.column()
                ))
            })?,
            None => None,
        };
        let Some((login, token)) = login.and_then(|login| {
            let token = login.token.clone()?;
            Some((login, token))
        }) else {
            return Ok(Answer {
                email,
                ..Answer::default()
            });
        };
        let answer = Answer {
            signed_in: true,
            subscription: login.subscription,
            tier: login.tier,
            email,
            ..Answer::default()
        };
        if login.expires.is_some_and(|at| at <= now as f64) {
            return Ok(Answer {
                expired: true,
                ..answer
            });
        }
        let response = (self.client()?.get(&*self.url))
            .bearer_auth(token)
            .header("anthropic-beta", "oauth-2025-04-20")
            .header(reqwest::header::ACCEPT, "application/json")
            .timeout(ANSWERING)
            .send()
            .await
            // What failed is the network, never the request's headers.
            .map_err(|e| Failure::new(format!("Anthropic was not reached: {}.", cause(&e))))?;
        let status = response.status().as_u16();
        let body = match status {
            200 => (response.bytes().await.ok()).and_then(|b| serde_json::from_slice(&b).ok()),
            _ => None,
        };
        Ok(Answer {
            status: Some(status),
            body,
            ..answer
        })
    }
}

/// What went wrong at the bottom of `error`: "connection refused", not
/// only "error sending request".
fn cause(error: &(dyn std::error::Error + 'static)) -> String {
    let mut at = error;
    while let Some(under) = at.source() {
        at = under;
    }
    at.to_string()
}

/// Where Claude Code keeps an entry's sign-in on this host.
struct Place {
    /// Its configuration folder, as the entry names it.
    folder: String,
    /// Whether that is Claude Code's own, `~/.claude`, whose `.claude.json`
    /// and Keychain item go by other names.
    standard: bool,
    home: PathBuf,
    /// Whether to look in the macOS Keychain first.
    keychain: bool,
}

impl Place {
    /// The entry's `CLAUDE_CONFIG_DIR`, else the engine's own, else
    /// Claude Code's own folder.
    fn of(harness: &Harness) -> Option<Place> {
        let named = |folder: Option<String>| folder.filter(|folder| !folder.is_empty());
        let folder =
            named(harness.env.get(CONFIG).cloned()).or_else(|| named(std::env::var(CONFIG).ok()));
        Some(Place::new(
            dirs::home_dir()?,
            folder,
            cfg!(target_os = "macos"),
        ))
    }

    fn new(home: PathBuf, folder: Option<String>, keychain: bool) -> Place {
        let own = home.join(".claude");
        let folder = folder.unwrap_or_else(|| own.display().to_string());
        Place {
            standard: Path::new(&folder) == own,
            folder,
            home,
            keychain,
        }
    }
}

/// Claude Code's sign-in, as it keeps it. It has no `Debug`, so its token
/// is printed nowhere.
struct Login {
    token: Option<String>,
    /// When the token expires, in ms since the epoch.
    expires: Option<f64>,
    subscription: Option<String>,
    tier: Option<String>,
}

impl Login {
    /// The sign-in `kept`, Claude Code's credentials, holds under
    /// `claudeAiOauth`; none when it holds none.
    fn read(kept: &str) -> Result<Option<Login>, serde_json::Error> {
        let kept: Value = serde_json::from_str(kept)?;
        let Some(oauth) = kept.get("claudeAiOauth").filter(|oauth| oauth.is_object()) else {
            return Ok(None);
        };
        let text = |key| {
            let said = oauth.get(key).and_then(Value::as_str);
            said.filter(|said| !said.is_empty()).map(str::to_owned)
        };
        Ok(Some(Login {
            token: text("accessToken"),
            expires: oauth.get("expiresAt").and_then(Value::as_f64),
            subscription: text("subscriptionType"),
            tier: text("rateLimitTier"),
        }))
    }
}

/// The text Claude Code keeps its sign-in in at `place`: the Keychain
/// item on macOS, else `.credentials.json` in the folder. None when it is
/// not there.
async fn kept(place: &Place) -> Result<Option<String>, Failure> {
    if place.keychain
        && let Some(item) = keychain(&service(&place.folder, place.standard)).await
    {
        return Ok(Some(item));
    }
    let file = Path::new(&place.folder).join(".credentials.json");
    match std::fs::read_to_string(&file) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(Failure::new(format!(
            "{} cannot be read: {error}.",
            file.display()
        ))),
    }
}

/// The Keychain item Claude Code keeps its sign-in in on macOS: a folder
/// other than its own has its own, named by the first 8 hex digits of the
/// folder's SHA-256.
fn service(folder: &str, standard: bool) -> String {
    if standard {
        return "Claude Code-credentials".to_owned();
    }
    let hash = Sha256::digest(folder.as_bytes());
    let hex: String = hash[..4].iter().map(|byte| format!("{byte:02x}")).collect();
    format!("Claude Code-credentials-{hex}")
}

/// A macOS Keychain item's secret, by `security`, as this computer's user;
/// none when it is not there or the Keychain does not answer in time. The
/// Keychain asks the Person once to let Banda read it.
async fn keychain(service: &str) -> Option<String> {
    let account = std::env::var("USER").ok()?;
    let asked = tokio::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-a", &account, "-s", service, "-w"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    let said = tokio::time::timeout(ANSWERING, asked).await.ok()?.ok()?;
    let secret = String::from_utf8_lossy(&said.stdout).trim().to_owned();
    (said.status.success() && !secret.is_empty()).then_some(secret)
}

/// The address Claude Code is signed in with, `oauthAccount.emailAddress`
/// in its `.claude.json`: in the folder, or beside it in the home for its
/// own folder. None when the file is not there or does not read.
fn email_in(place: &Place) -> Option<String> {
    let file = match place.standard {
        true => place.home.join(".claude.json"),
        false => Path::new(&place.folder).join(".claude.json"),
    };
    let kept: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    let email = kept.pointer("/oauthAccount/emailAddress")?.as_str()?;
    (!email.is_empty()).then(|| email.to_owned())
}

/// Reads `harness`'s limits with its sign-in on this host, from
/// `anthropic`.
pub(super) async fn read(harness: &Harness, anthropic: &Anthropic) -> Result<Found, Failure> {
    let place = Place::of(harness).ok_or_else(|| {
        Failure::new("This system names no home folder, where Claude Code keeps its sign-in.")
    })?;
    found(anthropic.asked(&place, banda_kernel::now_ms()).await?)
}

/// What the answer says, with the address it is signed in with, the read
/// failed or not.
fn found(answer: Answer) -> Result<Found, Failure> {
    let email = answer.email.clone().filter(|_| answer.signed_in);
    match limits(answer) {
        Ok(found) => Ok(Found { email, ..found }),
        Err(failure) => Err(Failure { email, ..failure }),
    }
}

fn limits(answer: Answer) -> Result<Found, Failure> {
    if !answer.signed_in {
        return Ok(Found::none("No one is signed in to Claude Code."));
    }
    if answer.expired {
        return Err(Failure::new(
            "Claude Code renews its sign-in on its next turn.",
        ));
    }
    match answer.status {
        Some(200) => {}
        Some(401 | 403) => {
            return Err(Failure::new(
                "Claude Code's sign-in expired: start it, or sign in again, to read its limits.",
            ));
        }
        Some(429) => {
            return Err(Failure {
                why: "Anthropic asked Banda to wait before it reads the limits again.".into(),
                wait: Some(WAIT),
                email: None,
            });
        }
        Some(status) => return Err(Failure::new(format!("Anthropic answered {status}."))),
        None => return Err(Failure::new("Anthropic answered nothing.")),
    }
    let windows = windows(&answer.body.unwrap_or_default());
    let note = (windows.is_empty()).then(|| "Anthropic says this account has no limits.".into());
    Ok(Found {
        plan: plan(answer.subscription.as_deref(), answer.tier.as_deref()),
        email: None,
        windows,
        note,
    })
}

/// The windows of Anthropic's answer: the session's and the week's, then
/// each model's own.
fn windows(body: &Value) -> Vec<LimitWindow> {
    let mut windows: Vec<LimitWindow> = (["five_hour", "seven_day"].into_iter())
        .filter_map(|id| {
            let bucket = body.get(id)?;
            let used = bucket.get("utilization")?.as_f64()?;
            let (kind, label, lasts) = scope(id);
            let kind = (kind, label.to_owned());
            Some(window(id.to_owned(), kind, used, resets(bucket), lasts))
        })
        .collect();
    let scoped = body.get("limits").and_then(Value::as_array);
    for entry in scoped.into_iter().flatten() {
        let model = entry.pointer("/scope/model");
        let Some(model) = model.and_then(|model| {
            let name = model.get("display_name").or_else(|| model.get("id"));
            name?.as_str().filter(|name| !name.is_empty())
        }) else {
            continue;
        };
        let Some(used) = entry.get("percent").and_then(Value::as_f64) else {
            continue;
        };
        let kind_said = entry.get("kind").and_then(Value::as_str).unwrap_or("");
        let id = format!("{kind_said}:{model}");
        if windows.iter().any(|window| window.id == id) {
            continue;
        }
        let (kind, label, lasts) = scope(kind_said);
        let kind = (kind, format!("{label} · {model}"));
        windows.push(window(id, kind, used, resets(entry), lasts));
    }
    windows
}

/// A window by what Anthropic names it: `five_hour`, `seven_day`, or a
/// model's kind, `weekly_scoped`.
fn scope(kind: &str) -> (WindowKind, &'static str, Option<i64>) {
    let kind = kind.to_lowercase();
    if kind.contains("month") {
        (WindowKind::Monthly, "Monthly", None)
    } else if kind.contains("week") || kind.contains("seven_day") {
        (WindowKind::Weekly, "Weekly", Some(7 * 24 * HOUR))
    } else if kind.contains("hour") || kind.contains("session") {
        (WindowKind::Session, "Session", Some(5 * HOUR))
    } else {
        (WindowKind::Other, "Limit", None)
    }
}

fn resets(bucket: &Value) -> Option<i64> {
    instant(bucket.get("resets_at")?.as_str()?)
}

/// The plan as Claude Code's sign-in names it: its subscription, with
/// the multiple its tier names, `Max 20x`; a tier says the ceiling, not
/// the plan, so a Team seat on Max's tier is `Team 5x`.
fn plan(subscription: Option<&str>, tier: Option<&str>) -> Option<String> {
    let plan = subscription.filter(|s| !s.is_empty()).map(|s| {
        let mut letters = s.chars();
        letters.next().map_or_else(String::new, |first| {
            first.to_uppercase().chain(letters).collect()
        })
    });
    let multiple = tier.and_then(|tier| {
        let tier = tier.to_lowercase();
        let after = &tier[tier.find("max_")? + 4..];
        let digits = after.find(|c: char| !c.is_ascii_digit())?;
        (digits > 0 && after[digits..].starts_with('x')).then(|| after[..=digits].to_owned())
    });
    match (plan, multiple) {
        (plan, Some(multiple)) => Some(format!("{} {multiple}", plan.as_deref().unwrap_or("Max"))),
        (plan, None) => plan,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const NOW: i64 = 1_793_800_000_000;

    /// Claude Code's credentials, with `oauth` as its sign-in.
    fn login(oauth: Value) -> String {
        json!({ "claudeAiOauth": oauth }).to_string()
    }

    fn signed(expires: i64) -> Value {
        json!({
            "accessToken": "sk-ant-oat01-secret",
            "expiresAt": expires,
            "subscriptionType": "max",
            "rateLimitTier": "default_claude_max_20x",
        })
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// A stand-in for Anthropic on this computer that answers every
    /// request with `status` and `extra` headers and `body`, and hands back
    /// each request's head, in lower case.
    async fn stand_in(
        status: u16,
        extra: &'static str,
        body: &'static str,
    ) -> (Anthropic, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/api/oauth/usage", listener.local_addr().unwrap());
        let (heard, heads) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut head = Vec::new();
                let mut byte = [0; 1];
                while !head.ends_with(b"\r\n\r\n") && socket.read(&mut byte).await.unwrap() == 1 {
                    head.push(byte[0]);
                }
                let _ = heard.send(String::from_utf8_lossy(&head).to_lowercase());
                let answer = format!(
                    "HTTP/1.1 {status} Said\r\ncontent-type: application/json\r\n{extra}\
                     content-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(answer.as_bytes()).await.unwrap();
            }
        });
        (Anthropic::at(&url), heads)
    }

    #[tokio::test]
    async fn the_sign_in_in_claude_codes_folder_asks_anthropic_once_and_the_answer_holds_no_token()
    {
        let home = tempfile::tempdir().unwrap();
        let home = home.path().to_owned();
        write(
            &home.join(".claude/.credentials.json"),
            &login(signed(NOW + 60_000)),
        );
        let (anthropic, mut heads) = stand_in(200, "", r#"{"five_hour":{"utilization":3}}"#).await;
        let answer = anthropic
            .asked(&Place::new(home, None, false), NOW)
            .await
            .unwrap();
        assert!(answer.signed_in);
        assert_eq!(answer.subscription.as_deref(), Some("max"));
        assert_eq!(answer.tier.as_deref(), Some("default_claude_max_20x"));
        assert_eq!((answer.status, answer.email.as_deref()), (Some(200), None));
        assert_eq!(answer.body.as_ref().unwrap()["five_hour"]["utilization"], 3);
        assert!(!format!("{answer:?}").contains("secret"));
        let head = heads.recv().await.unwrap();
        assert!(
            head.starts_with("get /api/oauth/usage http/1.1\r\n"),
            "{head}"
        );
        for header in [
            "authorization: bearer sk-ant-oat01-secret\r\n",
            "anthropic-beta: oauth-2025-04-20\r\n",
            "accept: application/json\r\n",
        ] {
            assert!(head.contains(header), "{header} in {head}");
        }
        assert!(heads.try_recv().is_err(), "asked once");
    }

    #[tokio::test]
    async fn an_entrys_own_folder_is_read_and_an_expired_or_missing_sign_in_asks_nothing() {
        let home = tempfile::tempdir().unwrap();
        let (home, work) = (home.path().join("home"), home.path().join("work"));
        write(&work.join(".credentials.json"), &login(signed(NOW - 1)));
        let (anthropic, mut heads) = stand_in(200, "", "{}").await;
        let work = Some(work.display().to_string());
        let at = Place::new(home.clone(), work, false);
        let expired = anthropic.asked(&at, NOW).await.unwrap();
        assert!(expired.signed_in && expired.expired);
        let at = Place::new(home, None, false);
        let missing = anthropic.asked(&at, NOW).await.unwrap();
        assert!(!missing.signed_in && missing.email.is_none());
        assert!(heads.try_recv().is_err(), "nothing asked");
    }

    #[tokio::test]
    async fn the_address_signed_in_comes_from_claude_json_beside_the_home_for_its_own_folder() {
        let root = tempfile::tempdir().unwrap();
        let (home, work, gone) = (
            root.path().join("home"),
            root.path().join("work"),
            root.path().join("gone"),
        );
        let account = |email: &str| {
            json!({ "oauthAccount": { "emailAddress": email }, "projects": {} }).to_string()
        };
        write(
            &home.join(".claude/.credentials.json"),
            &login(signed(NOW + 60_000)),
        );
        write(&home.join(".claude.json"), &account("p@example.com"));
        write(
            &home.join(".claude/.claude.json"),
            &account("not@example.com"),
        );
        write(&work.join(".credentials.json"), &login(signed(NOW - 1)));
        write(&work.join(".claude.json"), &account("w@example.com"));
        write(&gone.join(".claude.json"), "{ not json");
        let (anthropic, mut heads) = stand_in(200, "", "{}").await;
        let at = |folder: Option<&Path>| {
            let folder = folder.map(|folder| folder.display().to_string());
            Place::new(home.clone(), folder, false)
        };
        let own = anthropic.asked(&at(None), NOW).await.unwrap();
        assert_eq!(
            (own.status, own.email.as_deref()),
            (Some(200), Some("p@example.com"))
        );
        let work = anthropic.asked(&at(Some(&work)), NOW).await.unwrap();
        assert_eq!(
            (work.expired, work.email.as_deref()),
            (true, Some("w@example.com"))
        );
        let gone = anthropic.asked(&at(Some(&gone)), NOW).await.unwrap();
        assert_eq!((gone.signed_in, gone.email), (false, None));
        heads.recv().await.unwrap();
        assert!(heads.try_recv().is_err(), "asked once");
    }

    #[tokio::test]
    async fn the_token_goes_to_anthropic_alone_never_where_it_redirects() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path().to_owned();
        write(
            &home.join(".claude/.credentials.json"),
            &login(signed(NOW + 60_000)),
        );
        let elsewhere = "location: http://127.0.0.1:9/steal\r\n";
        let (anthropic, mut heads) = stand_in(302, elsewhere, "").await;
        let at = Place::new(home, None, false);
        assert_eq!(anthropic.asked(&at, NOW).await.unwrap().status, Some(302));
        heads.recv().await.unwrap();
        assert!(heads.try_recv().is_err(), "followed nowhere");
        let failure = found(Answer {
            status: Some(302),
            ..answered(Value::Null)
        });
        assert!(failure.unwrap_err().why.contains("302"));
    }

    #[tokio::test]
    async fn a_sign_in_that_does_not_read_says_where_and_never_what_it_holds() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path().to_owned();
        write(
            &home.join(".claude/.credentials.json"),
            "{\"claudeAiOauth\": {\"accessToken\": \"sk-",
        );
        let (anthropic, _heads) = stand_in(200, "", "{}").await;
        let failed = anthropic.asked(&Place::new(home, None, false), NOW).await;
        let why = failed.unwrap_err().why;
        assert!(why.contains("does not read, at line 1"), "{why}");
        assert!(!why.contains("sk-"), "{why}");
    }

    #[test]
    fn on_macos_the_keychain_holds_it_under_the_folders_own_item() {
        assert_eq!(service("/home/p/.claude", true), "Claude Code-credentials");
        // The first 8 hex digits of the folder's SHA-256, as Claude Code
        // names it: `printf %s /work | sha256sum`.
        assert_eq!(service("/work", false), "Claude Code-credentials-0c9a453f");
        let home = PathBuf::from("/home/p");
        assert!(Place::new(home.clone(), None, true).standard);
        assert!(Place::new(home.clone(), Some("/home/p/.claude/".into()), true).standard);
        assert!(!Place::new(home, Some("/work".into()), true).standard);
    }

    fn answered(body: Value) -> Answer {
        Answer {
            signed_in: true,
            subscription: Some("max".into()),
            tier: Some("default_claude_max_20x".into()),
            email: Some("p@example.com".into()),
            status: Some(200),
            body: Some(body),
            ..Answer::default()
        }
    }

    #[test]
    fn anthropics_answer_reads_as_windows() {
        let body = json!({
            "five_hour": { "utilization": 12.0, "resets_at": "2026-11-04T15:00:00+00:00" },
            "seven_day": { "utilization": 74.4, "resets_at": "2026-11-07T00:00:00Z" },
            "seven_day_opus": null,
            "limits": [
                { "kind": "weekly_scoped", "percent": 31, "resets_at": "2026-11-07T00:00:00Z",
                  "scope": { "model": { "id": "claude-fable-5-1", "display_name": "Fable" } } },
                { "kind": "weekly_scoped", "percent": 31,
                  "scope": { "model": { "id": "claude-fable-5-1", "display_name": "Fable" } } },
                { "kind": "weekly", "percent": 74.4 }
            ]
        });
        let found = found(answered(body)).unwrap();
        assert_eq!(found.plan.as_deref(), Some("Max 20x"));
        assert_eq!(found.email.as_deref(), Some("p@example.com"));
        let said: Vec<(&str, f64)> = (found.windows.iter())
            .map(|w| (w.label.as_str(), w.used))
            .collect();
        assert_eq!(
            said,
            [
                ("Session", 12.0),
                ("Weekly", 74.4),
                ("Weekly · Fable", 31.0)
            ]
        );
        assert_eq!(found.windows[0].resets_at, Some(1_793_804_400_000));
        assert_eq!(found.windows[2].kind, WindowKind::Weekly);
    }

    #[test]
    fn what_goes_wrong_says_why() {
        let signed_out = found(Answer::default()).unwrap();
        assert!(signed_out.windows.is_empty() && signed_out.note.is_some());
        let expired = Answer {
            signed_in: true,
            expired: true,
            email: Some("p@example.com".into()),
            ..Answer::default()
        };
        let expired = found(expired).unwrap_err();
        assert!(expired.why.contains("next turn"));
        assert_eq!(
            expired.email.as_deref(),
            Some("p@example.com"),
            "still named"
        );
        let wait = Answer {
            status: Some(429),
            ..answered(Value::Null)
        };
        assert_eq!(found(wait).unwrap_err().wait, Some(WAIT));
        let refused = Answer {
            status: Some(401),
            ..answered(Value::Null)
        };
        assert!(found(refused).unwrap_err().why.contains("expired"));
    }

    #[test]
    fn a_plan_is_named_as_claude_code_names_it() {
        assert_eq!(plan(Some("pro"), None).as_deref(), Some("Pro"));
        assert_eq!(
            plan(Some("team"), Some("default_claude_max_5x")).as_deref(),
            Some("Team 5x")
        );
        assert_eq!(plan(None, Some("max_20x")).as_deref(), Some("Max 20x"));
        assert_eq!(plan(None, Some("default")), None);
    }
}
