//! gh's sign-in, as gh keeps it (ADR 0083): the account it is signed in
//! to on a host, and its token there, which the engine gives the Harnesses
//! of a Project the Person said they trust, uses for the fetch it runs by
//! itself there, and reads pull requests with. A `gh` an Agent could
//! change would run outside the fence, so on Linux the engine runs none
//! for it, and reads them where gh keeps them:
//!
//! - a variable gh takes a token from first, in the engine's own
//!   environment: `GH_TOKEN` or `GITHUB_TOKEN` for github.com and a
//!   `*.ghe.com` host, `GH_ENTERPRISE_TOKEN` or `GITHUB_ENTERPRISE_TOKEN`
//!   for the host `GH_HOST` names;
//! - the host's `oauth_token` in gh's `hosts.yml`, where gh keeps it when
//!   it has no keyring;
//! - the system's keyring, through the Secret Service on the session bus:
//!   the item gh keeps for the host's active account, else the one it
//!   keeps by the account's login. A keyring that is locked is not asked
//!   to unlock, and none is started for this.
//!
//! On macOS and Windows, which have no fence yet, `gh auth token` says it,
//! as it did. The account is read from `hosts.yml` everywhere.
//!
//! A token read is kept ten minutes, and that there is none half a
//! minute, as the Person may sign in; why there is none the log says once.

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The host every github.com account is on.
pub const GITHUB: &str = "github.com";

/// How long a token read is kept.
const KEPT_FOR: Duration = Duration::from_secs(10 * 60);

/// How long that there is none is kept: the Person may sign in.
const NONE_KEPT_FOR: Duration = Duration::from_secs(30);

/// The most of `hosts.yml` read: gh's has a few lines for each host.
const HOSTS_MOST: u64 = 1024 * 1024;

/// How long the keyring, or `gh`, may take to say it.
const ASKED_WITHIN: Duration = Duration::from_secs(2);

/// Each host's token as last read, and when.
static KEPT: Mutex<BTreeMap<String, (Instant, Option<String>)>> = Mutex::new(BTreeMap::new());

/// Each host and why it had no token, said in the log once.
static SAID: Mutex<BTreeSet<(String, &'static str)>> = Mutex::new(BTreeSet::new());

/// Why there is no token.
#[derive(Debug, PartialEq, Eq)]
enum Missing {
    /// gh is signed out of the host, or never signed in there.
    SignedOut,
    /// The keyring holds it, and is locked: only Linux's is read.
    #[cfg_attr(not(target_os = "linux"), expect(dead_code))]
    Locked,
    /// It could not be read now, as the words say: the last read holds.
    Unread(String),
}

impl Missing {
    fn kind(&self) -> &'static str {
        match self {
            Missing::SignedOut => "signed out",
            Missing::Locked => "locked",
            Missing::Unread(_) => "unread",
        }
    }
}

/// Where gh keeps its config: `GH_CONFIG_DIR`, else `gh` in
/// `XDG_CONFIG_HOME`, else `GitHub CLI` in Windows' `AppData`, else
/// `.config/gh` in the home folder.
pub fn folder() -> Option<PathBuf> {
    folder_in(|name| std::env::var_os(name), dirs::home_dir())
}

fn folder_in(var: impl Fn(&str) -> Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    let var = |name: &str| {
        var(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    if let Some(named) = var("GH_CONFIG_DIR") {
        return Some(named);
    }
    if let Some(config) = var("XDG_CONFIG_HOME") {
        return Some(config.join("gh"));
    }
    if cfg!(windows)
        && let Some(app_data) = var("AppData")
    {
        return Some(app_data.join("GitHub CLI"));
    }
    Some(home?.join(".config").join("gh"))
}

/// What gh's `hosts.yml` in `folder` says: none when it is not there.
fn hosts(folder: &Path) -> Option<String> {
    use std::io::Read;
    let mut text = String::new();
    std::fs::File::open(folder.join("hosts.yml"))
        .ok()?
        .take(HOSTS_MOST)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}

/// The account gh is signed in to on `host`, as its `hosts.yml` says.
pub fn login(host: &str) -> Option<String> {
    value(&hosts(&folder()?)?, host, "user")
}

/// The value `host`'s own `key` has in the text of gh's `hosts.yml`: its
/// block is the lines under `host:` that stand further in, and its own
/// keys the first of them in. Quotes around a value are left out.
fn value(hosts: &str, host: &str, key: &str) -> Option<String> {
    let unquoted = |text: &str| {
        let text = text.trim();
        let quote = text.chars().next().filter(|c| *c == '"' || *c == '\'');
        match quote.and_then(|quote| text[1..].split_once(quote)) {
            Some((quoted, _)) => quoted.to_owned(),
            None => text
                .split(" #")
                .next()
                .unwrap_or_default()
                .trim()
                .to_owned(),
        }
    };
    let mut inside = false;
    let mut own_indent = None;
    for line in hosts.lines() {
        let content = line.trim_start();
        if content.is_empty() || content.starts_with('#') {
            continue;
        }
        let indent = line.len() - content.len();
        let Some((name, rest)) = content.split_once(':') else {
            continue;
        };
        if indent == 0 {
            inside = unquoted(name).eq_ignore_ascii_case(host);
            own_indent = None;
            continue;
        }
        if !inside {
            continue;
        }
        let own = *own_indent.get_or_insert(indent);
        if indent == own && unquoted(name) == key {
            let found = unquoted(rest);
            return (!found.is_empty()).then_some(found);
        }
    }
    None
}

/// The token gh is signed in with on `host`: none when it is signed out
/// there, or it could not be read. Kept a while ([`KEPT_FOR`]).
pub async fn token(host: &str) -> Option<String> {
    let host = host.to_ascii_lowercase();
    let last = KEPT.lock().unwrap().get(&host).cloned();
    if let Some((at, token)) = &last {
        let kept_for = match token {
            Some(_) => KEPT_FOR,
            None => NONE_KEPT_FOR,
        };
        if at.elapsed() < kept_for {
            return token.clone();
        }
    }
    let token = match read(&host).await {
        Ok(token) => Some(token),
        Err(missing) => {
            let kind = missing.kind();
            if SAID.lock().unwrap().insert((host.clone(), kind)) {
                let why = match &missing {
                    Missing::SignedOut => "gh is not signed in there".to_owned(),
                    Missing::Locked => "the keyring that holds gh's token is locked".to_owned(),
                    Missing::Unread(words) => words.clone(),
                };
                tracing::warn!(
                    host,
                    why,
                    "Banda has no GitHub token of the Person's for this host: Agents in a \
                     Project they trust get none, and Banda's own fetch and pull requests go \
                     without it"
                );
            }
            match missing {
                // Slow, or the keyring busy a moment: the last one read holds.
                Missing::Unread(_) => last.and_then(|(_, token)| token),
                _ => None,
            }
        }
    };
    KEPT.lock()
        .unwrap()
        .insert(host, (Instant::now(), token.clone()));
    token
}

/// Keeps `token` for `host` as if it had just been read: for a test, on a
/// machine whose gh holds what it holds.
pub fn keep(host: &str, token: Option<String>) {
    let host = host.to_ascii_lowercase();
    KEPT.lock().unwrap().insert(host, (Instant::now(), token));
}

/// The token gh would use on `host`, read where gh keeps it.
async fn read(host: &str) -> Result<String, Missing> {
    let var = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    if let Some(token) = from_env(host, var) {
        return Ok(token);
    }
    let folder = folder();
    let hosts = folder.as_deref().and_then(hosts).unwrap_or_default();
    if let Some(token) = value(&hosts, host, "oauth_token") {
        return Ok(token);
    }
    let login = value(&hosts, host, "user");
    kept(host, login.as_deref()).await
}

/// The token a variable of `var`'s names for `host`, as gh takes it.
fn from_env(host: &str, var: impl Fn(&str) -> Option<String>) -> Option<String> {
    let names = if host == GITHUB || host.ends_with(".ghe.com") {
        ["GH_TOKEN", "GITHUB_TOKEN"]
    } else if var("GH_HOST").is_some_and(|named| named.eq_ignore_ascii_case(host)) {
        ["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]
    } else {
        return None;
    };
    names.into_iter().find_map(var)
}

/// The token the keyring keeps for gh on `host`.
#[cfg(target_os = "linux")]
async fn kept(host: &str, login: Option<&str>) -> Result<String, Missing> {
    match tokio::time::timeout(ASKED_WITHIN, keyring::token(host, login)).await {
        Ok(found) => found,
        Err(_) => Err(Missing::Unread(
            "the keyring took too long to answer".to_owned(),
        )),
    }
}

/// The token `gh auth token` says, where Banda has no fence yet: gh reads
/// the system's own keyring.
#[cfg(not(target_os = "linux"))]
async fn kept(host: &str, _login: Option<&str>) -> Result<String, Missing> {
    let mut asking = crate::host::own("gh")
        .map_err(|_| Missing::Unread("there is no gh on the PATH".to_owned()))?;
    asking
        .args(["auth", "token", "--hostname", host])
        .current_dir(std::env::temp_dir())
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(std::process::Stdio::null());
    let Ok(Ok(output)) = tokio::time::timeout(ASKED_WITHIN, asking.output()).await else {
        return Err(Missing::Unread("gh did not answer in time".to_owned()));
    };
    let token = String::from_utf8(output.stdout).unwrap_or_default();
    match token.trim() {
        "" => Err(Missing::SignedOut),
        token if output.status.success() => Ok(token.to_owned()),
        _ => Err(Missing::SignedOut),
    }
}

/// The Secret Service, as gh's keyring library keeps a token in it: an
/// item with the attributes `service`, `gh:<host>`, and `username`,
/// empty for the host's active account and the login for each.
#[cfg(target_os = "linux")]
mod keyring {
    use super::Missing;
    use std::collections::HashMap;
    use zbus::proxy::{CacheProperties, MethodFlags};
    use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};

    const SECRETS: &str = "org.freedesktop.secrets";
    const SERVICE_PATH: &str = "/org/freedesktop/secrets";
    const SERVICE: &str = "org.freedesktop.Secret.Service";
    const SESSION: &str = "org.freedesktop.Secret.Session";

    /// What `GetSecrets` answers for each item: its session, the
    /// parameters, the secret and its content type.
    type Secret = (OwnedObjectPath, Vec<u8>, Vec<u8>, String);

    fn unread(error: zbus::Error) -> Missing {
        match &error {
            zbus::Error::MethodError(name, ..)
                if name.as_str() == "org.freedesktop.DBus.Error.ServiceUnknown"
                    || name.as_str() == "org.freedesktop.DBus.Error.NameHasNoOwner" =>
            {
                Missing::Unread("no keyring answers on the session bus".to_owned())
            }
            _ => Missing::Unread(format!("the keyring could not be read: {error}")),
        }
    }

    /// The token kept for `host`: its active account's, else `login`'s.
    pub(super) async fn token(host: &str, login: Option<&str>) -> Result<String, Missing> {
        let bus = zbus::Connection::session().await.map_err(unread)?;
        token_on(&bus, host, login).await
    }

    /// [`token`], asked on `bus`.
    pub(super) async fn token_on(
        bus: &zbus::Connection,
        host: &str,
        login: Option<&str>,
    ) -> Result<String, Missing> {
        // Asked as no program that starts one: a keyring the bus would
        // start for it could be a program an Agent wrote.
        let flags = || MethodFlags::NoAutoStart.into();
        let proxy = |path: &'static str, interface: &'static str| {
            zbus::proxy::Builder::<zbus::Proxy>::new(bus)
                .destination(SECRETS)
                .and_then(|built| built.path(path))
                .and_then(|built| built.interface(interface))
                .map(|built| built.cache_properties(CacheProperties::No))
        };
        let service = proxy(SERVICE_PATH, SERVICE)
            .map_err(unread)?
            .build()
            .await
            .map_err(unread)?;
        let opened: Option<(OwnedValue, OwnedObjectPath)> = service
            .call_with_flags("OpenSession", flags(), &("plain", Value::from("")))
            .await
            .map_err(unread)?;
        let (_, session) =
            opened.ok_or_else(|| unread(zbus::Error::MissingParameter("session")))?;
        let service_name = format!("gh:{host}");
        let mut locked = false;
        let mut found = None;
        for username in std::iter::once("").chain(login) {
            let asked = HashMap::from([("service", service_name.as_str()), ("username", username)]);
            let items: Option<(Vec<OwnedObjectPath>, Vec<OwnedObjectPath>)> = service
                .call_with_flags("SearchItems", flags(), &(asked,))
                .await
                .map_err(unread)?;
            let (open, shut) = items.unwrap_or_default();
            locked |= !shut.is_empty();
            let Some(item) = open.into_iter().next() else {
                continue;
            };
            let items: Vec<ObjectPath> = vec![item.as_ref()];
            let secrets: Option<HashMap<OwnedObjectPath, Secret>> = service
                .call_with_flags("GetSecrets", flags(), &(items, session.as_ref()))
                .await
                .map_err(unread)?;
            let secret = secrets.and_then(|secrets| secrets.into_values().next());
            if let Some((_, _, value, _)) = secret {
                let token = String::from_utf8(value).unwrap_or_default();
                if !token.trim().is_empty() {
                    found = Some(token.trim().to_owned());
                    break;
                }
            }
        }
        if let Ok(closing) = proxy(SESSION, SESSION) {
            let closing = closing.path(session.as_ref()).map(|built| built.build());
            if let Ok(closing) = closing
                && let Ok(session) = closing.await
            {
                let _: Result<Option<()>, _> = session.call_with_flags("Close", flags(), &()).await;
            }
        }
        match (found, locked) {
            (Some(token), _) => Ok(token),
            (None, true) => Err(Missing::Locked),
            (None, false) => Err(Missing::SignedOut),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// gh's `hosts.yml` with two hosts, the first signed in with no
    /// keyring, as gh 2.40 and later write it.
    const HOSTS: &str = "\
github.com:
    users:
        octo:
            oauth_token: gho_other
    oauth_token: gho_active
    user: octo
ghe.example.com:
    user: \"enterprise\"
    oauth_token: 'ghe_token' # a comment
";

    #[test]
    fn a_host_s_own_values_are_read_from_gh_s_hosts_file() {
        assert_eq!(value(HOSTS, GITHUB, "user").as_deref(), Some("octo"));
        assert_eq!(
            value(HOSTS, "GitHub.com", "oauth_token").as_deref(),
            Some("gho_active"),
            "the host's own, not an account's under it"
        );
        let enterprise = "ghe.example.com";
        assert_eq!(
            value(HOSTS, enterprise, "user").as_deref(),
            Some("enterprise")
        );
        assert_eq!(
            value(HOSTS, enterprise, "oauth_token").as_deref(),
            Some("ghe_token")
        );
        assert_eq!(value(HOSTS, "gitlab.com", "user"), None);
        // Kept in the keyring: no token in the file.
        let keyring = "github.com:\n    users:\n        octo:\n    user: octo\n";
        assert_eq!(value(keyring, GITHUB, "oauth_token"), None);
        assert_eq!(value(keyring, GITHUB, "user").as_deref(), Some("octo"));
    }

    #[test]
    fn a_variable_gives_a_token_only_for_the_hosts_gh_gives_it_to() {
        let vars = |name: &str| match name {
            "GH_TOKEN" => Some("env".to_owned()),
            "GH_ENTERPRISE_TOKEN" => Some("ghe".to_owned()),
            "GH_HOST" => Some("ghe.example.com".to_owned()),
            _ => None,
        };
        assert_eq!(from_env(GITHUB, vars).as_deref(), Some("env"));
        assert_eq!(from_env("acme.ghe.com", vars).as_deref(), Some("env"));
        assert_eq!(from_env("ghe.example.com", vars).as_deref(), Some("ghe"));
        assert_eq!(from_env("elsewhere.example", vars), None);
        assert_eq!(from_env(GITHUB, |_| None), None);
    }

    #[test]
    fn gh_s_config_folder_is_where_gh_looks() {
        let home = Some(PathBuf::from("/home/ann"));
        let none = |_: &str| None;
        assert_eq!(
            folder_in(none, home.clone()),
            Some(PathBuf::from("/home/ann/.config/gh"))
        );
        let xdg = |name: &str| (name == "XDG_CONFIG_HOME").then(|| OsString::from("/x"));
        assert_eq!(folder_in(xdg, home.clone()), Some(PathBuf::from("/x/gh")));
        let named = |name: &str| (name == "GH_CONFIG_DIR").then(|| OsString::from("/gh"));
        assert_eq!(folder_in(named, home), Some(PathBuf::from("/gh")));
    }

    /// A keyring on the far end of a pair of sockets, with gh's items:
    /// each with its attributes, whether it is locked, and its secret.
    #[cfg(target_os = "linux")]
    mod keyring_s {
        use super::super::{Missing, keyring};
        use std::collections::HashMap;
        use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

        type Item = (HashMap<String, String>, bool, Vec<u8>);

        struct Fake(Vec<Item>);

        fn path(at: usize) -> OwnedObjectPath {
            let named = format!("/org/freedesktop/secrets/collection/login/{at}");
            OwnedObjectPath::try_from(named).unwrap()
        }

        #[zbus::interface(name = "org.freedesktop.Secret.Service")]
        impl Fake {
            fn open_session(
                &self,
                algorithm: &str,
                _input: Value<'_>,
            ) -> (OwnedValue, OwnedObjectPath) {
                assert_eq!(algorithm, "plain");
                let session = OwnedObjectPath::try_from("/org/freedesktop/secrets/session/1");
                (OwnedValue::from(0u32), session.unwrap())
            }

            fn search_items(
                &self,
                asked: HashMap<String, String>,
            ) -> (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) {
                let (mut open, mut shut) = (Vec::new(), Vec::new());
                for (at, (attributes, locked, _)) in self.0.iter().enumerate() {
                    if asked
                        .iter()
                        .all(|(key, value)| attributes.get(key) == Some(value))
                    {
                        match locked {
                            true => shut.push(path(at)),
                            false => open.push(path(at)),
                        }
                    }
                }
                (open, shut)
            }

            fn get_secrets(
                &self,
                items: Vec<OwnedObjectPath>,
                session: OwnedObjectPath,
            ) -> HashMap<OwnedObjectPath, (OwnedObjectPath, Vec<u8>, Vec<u8>, String)> {
                let secret = |item: &OwnedObjectPath| {
                    let at = (0..self.0.len()).find(|at| path(*at) == *item)?;
                    let value = self.0[at].2.clone();
                    Some((session.clone(), Vec::new(), value, "text/plain".to_owned()))
                };
                (items.iter())
                    .filter_map(|item| Some((item.clone(), secret(item)?)))
                    .collect()
            }
        }

        fn item(host: &str, username: &str, locked: bool, secret: &str) -> Item {
            let attributes = HashMap::from([
                ("service".to_owned(), format!("gh:{host}")),
                ("username".to_owned(), username.to_owned()),
            ]);
            (attributes, locked, secret.as_bytes().to_vec())
        }

        async fn asked(
            items: Vec<Item>,
            host: &str,
            login: Option<&str>,
        ) -> Result<String, Missing> {
            let (ours, theirs) = tokio::net::UnixStream::pair().unwrap();
            let guid = zbus::Guid::generate();
            let serving = zbus::connection::Builder::unix_stream(theirs)
                .server(guid)
                .unwrap()
                .p2p()
                .serve_at("/org/freedesktop/secrets", Fake(items))
                .unwrap()
                .build();
            let asking = zbus::connection::Builder::unix_stream(ours).p2p().build();
            let (_keyring, bus) = tokio::try_join!(serving, asking).unwrap();
            keyring::token_on(&bus, host, login).await
        }

        #[tokio::test]
        async fn gh_s_token_is_read_from_the_keyring_by_its_host_and_account() {
            let items = vec![
                item("ghe.example.com", "", false, "ghe_other"),
                item("github.com", "octo", false, "gho_by_login"),
                item("github.com", "", false, "gho_active"),
            ];
            let found = asked(items.clone(), "github.com", Some("octo")).await;
            assert_eq!(
                found,
                Ok("gho_active".to_owned()),
                "the active account's first"
            );
            let older = vec![items[0].clone(), items[1].clone()];
            let found = asked(older.clone(), "github.com", Some("octo")).await;
            assert_eq!(
                found,
                Ok("gho_by_login".to_owned()),
                "as gh before 2.40 kept it"
            );
            let found = asked(older, "github.com", None).await;
            assert_eq!(found, Err(Missing::SignedOut));
            let locked = vec![item("github.com", "", true, "gho_locked")];
            let found = asked(locked, "github.com", Some("octo")).await;
            assert_eq!(
                found,
                Err(Missing::Locked),
                "a locked keyring is not opened"
            );
        }
    }
}
