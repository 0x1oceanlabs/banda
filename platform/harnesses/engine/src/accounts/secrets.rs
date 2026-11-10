//! The machine's secrets (ADR 0078, decision 1): a gateway's key, the only
//! secret Banda keeps. It goes in the system keyring where there is one:
//! the Secret Service on Linux, the Keychain on macOS, the Credential
//! Manager on Windows. A host with no keyring, a server with no screen,
//! keeps it in a file of its own that only its owner reads.
//!
//! What the Person typed may be a reference instead, `op://…` for
//! 1Password or `pass:<name>` for pass: it is kept as typed, and read
//! through that program each time the Harness asks.
//!
//! The window writes a key and never reads it back. The Harness asks for
//! it with `banda secret get <account>` ([`super::Accounts::secret`]).

use banda_kernel::Refusal;
use keyring_core::{CredentialStore, Entry, Error};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use ts_rs::TS;

/// How long a reference's program may take to answer, a prompt to unlock
/// it included.
const READING: Duration = Duration::from_secs(60);

/// Where a secret went.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "harnesses/")]
pub enum Kept {
    /// The system keyring.
    Keyring,
    /// A file of Banda's state that only its owner reads: this host has
    /// no keyring.
    File,
}

#[derive(Clone)]
pub struct Secrets {
    /// What names this Banda's items in the keyring, its data folder's
    /// name, so Banda Dev's are not Banda's.
    service: String,
    /// The keyring: this host's, looked for each time a secret is until
    /// found, as a session's may start after the engine; or a test's.
    keyring: Arc<Mutex<Option<Arc<CredentialStore>>>>,
    /// Whether the keyring is looked for: not where a test gave it.
    looks: bool,
    /// Whether each account has a secret, as last kept, forgotten or read:
    /// a look at the account asks the keyring no more.
    known: Arc<Mutex<HashMap<String, bool>>>,
    /// Where a host with no keyring keeps them, a file each.
    folder: PathBuf,
}

impl Secrets {
    /// The secrets of the Banda whose items `service` names, in this
    /// host's keyring, else in files in `folder`.
    pub fn new(service: &str, folder: PathBuf) -> Secrets {
        Secrets::of(service, folder, None, true)
    }

    /// As [`Secrets::new`], with `keyring` as the system's: a test's.
    pub fn with_keyring(
        service: &str,
        folder: PathBuf,
        keyring: Option<Arc<CredentialStore>>,
    ) -> Secrets {
        Secrets::of(service, folder, keyring, false)
    }

    fn of(
        service: &str,
        folder: PathBuf,
        keyring: Option<Arc<CredentialStore>>,
        looks: bool,
    ) -> Secrets {
        Secrets {
            service: service.to_owned(),
            keyring: Arc::new(Mutex::new(keyring)),
            looks,
            known: Arc::default(),
            folder,
        }
    }

    /// Keeps `value` as `account`'s secret: in the keyring, else, where it
    /// has none or refuses, in its file.
    pub async fn put(&self, account: &str, value: &str) -> Result<Kept, Refusal> {
        let value = value.trim().to_owned();
        if value.is_empty() {
            return Err(Refusal::invalid("The key is empty."));
        }
        let kept = self
            .blocking(account, move |this, account| {
                if let Some(entry) = this.entry(account) {
                    match entry.set_password(&value) {
                        Ok(()) => {
                            // An older copy in a file would outlive this one.
                            let _ = std::fs::remove_file(this.file(account));
                            return Ok(Kept::Keyring);
                        }
                        Err(error) => {
                            tracing::warn!(%error, "the keyring keeps no secret: a file does")
                        }
                    }
                }
                write_private(&this.folder, &this.file(account), &value)
                    .map_err(|e| Refusal::conflict(format!("The key could not be kept: {e}.")))?;
                Ok(Kept::File)
            })
            .await?;
        self.knows(account, true);
        Ok(kept)
    }

    /// Whether `account` has a secret kept.
    pub async fn has(&self, account: &str) -> bool {
        let known = self.known.lock().unwrap().get(account).copied();
        match known {
            Some(has) => has,
            None => self.kept(account).await.is_ok_and(|kept| kept.is_some()),
        }
    }

    /// `account`'s secret: what its reference reads, for one.
    pub async fn get(&self, account: &str) -> Result<String, Refusal> {
        let value = self
            .kept(account)
            .await?
            .ok_or_else(|| Refusal::not_found("No key is kept for this Account."))?;
        match reader(&value) {
            Some((program, args)) => read(program, &args).await,
            None => Ok(value),
        }
    }

    /// Forgets `account`'s secret, wherever it is.
    pub async fn forget(&self, account: &str) -> Result<(), Refusal> {
        self.blocking(account, |this, account| {
            if let Some(entry) = this.entry(account) {
                match entry.delete_credential() {
                    Ok(()) | Err(Error::NoEntry) => {}
                    Err(error) => {
                        return Err(Refusal::conflict(format!(
                            "The keyring kept the key: {error}."
                        )));
                    }
                }
            }
            match std::fs::remove_file(this.file(account)) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(
                    Refusal::conflict(format!("The key's file could not go: {error}.")),
                ),
                _ => Ok(()),
            }
        })
        .await?;
        self.knows(account, false);
        Ok(())
    }

    /// What is kept for `account`, as it was typed: from the keyring,
    /// else from its file.
    async fn kept(&self, account: &str) -> Result<Option<String>, Refusal> {
        let kept = self
            .blocking(account, |this, account| {
                if let Some(entry) = this.entry(account) {
                    match entry.get_password() {
                        Ok(value) => return Ok(Some(value)),
                        Err(Error::NoEntry) => {}
                        Err(error) => tracing::warn!(%error, "the keyring could not be read"),
                    }
                }
                match std::fs::read_to_string(this.file(account)) {
                    Ok(value) => Ok(Some(value.trim().to_owned())),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                    Err(error) => Err(Refusal::conflict(format!(
                        "The key's file could not be read: {error}."
                    ))),
                }
            })
            .await?;
        self.knows(account, kept.is_some());
        Ok(kept)
    }

    fn knows(&self, account: &str, has: bool) {
        self.known.lock().unwrap().insert(account.to_owned(), has);
    }

    /// Runs `work` for `account` on a thread that may block, as the
    /// keyring does.
    async fn blocking<T: Send + 'static>(
        &self,
        account: &str,
        work: impl FnOnce(&Secrets, &str) -> Result<T, Refusal> + Send + 'static,
    ) -> Result<T, Refusal> {
        let (this, account) = (self.clone(), account.to_owned());
        tokio::task::spawn_blocking(move || work(&this, &account))
            .await
            .map_err(|e| Refusal::conflict(format!("The secrets could not be reached: {e}.")))?
    }

    fn entry(&self, account: &str) -> Option<Entry> {
        let keyring = {
            let mut keyring = self.keyring.lock().unwrap();
            if keyring.is_none() && self.looks {
                *keyring = system();
            }
            keyring.clone()?
        };
        keyring
            .build(&self.service, account, None)
            .inspect_err(|error| tracing::warn!(%error, "no keyring item for an Account"))
            .ok()
    }

    fn file(&self, account: &str) -> PathBuf {
        self.folder.join(account)
    }
}

/// This host's keyring, if it has one: none on a Linux with no Secret
/// Service, as a server with no screen, nor where `BANDA_KEYRING=off`
/// says to keep secrets in files, as a test's engine does.
fn system() -> Option<Arc<CredentialStore>> {
    if std::env::var_os("BANDA_KEYRING").is_some_and(|v| v == "off") {
        return None;
    }
    #[cfg(target_os = "macos")]
    let store = apple_native_keyring_store::keychain::Store::new();
    #[cfg(windows)]
    let store = windows_native_keyring_store::Store::new();
    #[cfg(all(unix, not(target_os = "macos")))]
    let store = zbus_secret_service_keyring_store::Store::new();
    match store {
        Ok(store) => Some(store as Arc<CredentialStore>),
        Err(error) => {
            tracing::debug!(%error, "no keyring here: secrets go in files");
            None
        }
    }
}

/// The program that reads a reference, and its arguments: `op read` for
/// 1Password's `op://`, `pass show` for `pass:`. None for a key itself.
fn reader(value: &str) -> Option<(&'static str, Vec<String>)> {
    if value.starts_with("op://") {
        Some(("op", vec!["read".into(), value.into()]))
    } else {
        let name = value.strip_prefix("pass:")?;
        Some(("pass", vec!["show".into(), name.trim().into()]))
    }
}

/// What `program` prints for a reference: its first line. The engine
/// runs it on the host, as the Person's password manager is there.
async fn read(program: &str, args: &[String]) -> Result<String, Refusal> {
    let mut command = banda_kernel::host::own(program)
        .map_err(|e| Refusal::conflict(format!("`{program}` could not run: {e}.")))?;
    let asked = command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(READING, asked)
        .await
        .map_err(|_| Refusal::conflict(format!("`{program}` did not answer in a minute.")))?
        .map_err(|e| Refusal::conflict(format!("`{program}` could not run: {e}.")))?;
    if !output.status.success() {
        let said = String::from_utf8_lossy(&output.stderr);
        return Err(Refusal::conflict(format!(
            "`{program}` could not read the key: {}",
            said.trim()
        )));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    match text.lines().next().map(str::trim) {
        Some(line) if !line.is_empty() => Ok(line.to_owned()),
        _ => Err(Refusal::conflict(format!("`{program}` printed no key."))),
    }
}

/// Writes `value` to `file` in `folder`, both only their owner's.
fn write_private(folder: &Path, file: &Path, value: &str) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(folder)?;
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o700))?;
        let fresh = file.with_extension("new");
        let mut written = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&fresh)?;
        written.write_all(value.as_bytes())?;
        written.sync_all()?;
        banda_kernel::host::rename(&fresh, file)
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(folder)?;
        std::fs::write(file, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secrets(root: &Path, keyring: bool) -> Secrets {
        let keyring = keyring.then(|| keyring_core::mock::Store::new().unwrap() as Arc<_>);
        Secrets::with_keyring("banda-test", root.join("secrets"), keyring)
    }

    #[tokio::test]
    async fn a_key_goes_in_the_keyring_and_never_in_a_file() {
        let root = tempfile::tempdir().unwrap();
        let secrets = secrets(root.path(), true);
        assert!(!secrets.has("gw").await);
        assert_eq!(
            secrets.put("gw", " sk-or-1\n").await.unwrap(),
            Kept::Keyring
        );
        assert_eq!(secrets.get("gw").await.unwrap(), "sk-or-1");
        assert!(!root.path().join("secrets/gw").exists());
        secrets.forget("gw").await.unwrap();
        assert!(!secrets.has("gw").await);
        assert!(secrets.get("gw").await.is_err());
    }

    #[tokio::test]
    async fn a_host_with_no_keyring_keeps_a_key_in_a_file_only_its_owner_reads() {
        let root = tempfile::tempdir().unwrap();
        let secrets = secrets(root.path(), false);
        assert_eq!(secrets.put("gw", "sk-or-2").await.unwrap(), Kept::File);
        assert_eq!(secrets.get("gw").await.unwrap(), "sk-or-2");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&root.path().join("secrets")), 0o700);
            assert_eq!(mode(&root.path().join("secrets/gw")), 0o600);
        }
        secrets.forget("gw").await.unwrap();
        assert!(!root.path().join("secrets/gw").exists());
        assert!(secrets.put("gw", "  ").await.is_err(), "an empty key");
    }

    #[test]
    fn a_reference_is_read_by_its_program() {
        assert_eq!(
            reader("op://Private/OpenRouter/key"),
            Some((
                "op",
                vec!["read".into(), "op://Private/OpenRouter/key".into()]
            ))
        );
        assert_eq!(
            reader("pass: api/openrouter"),
            Some(("pass", vec!["show".into(), "api/openrouter".into()]))
        );
        assert_eq!(reader("sk-or-v1-abc"), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_reference_s_program_gives_its_first_line_or_says_why_not() {
        assert_eq!(
            read("sh", &["-c".into(), "printf 'sk-1\\nnotes\\n'".into()])
                .await
                .unwrap(),
            "sk-1"
        );
        let refused = read("sh", &["-c".into(), "echo locked >&2; exit 1".into()])
            .await
            .unwrap_err();
        assert!(refused.message.contains("locked"), "{}", refused.message);
    }
}
