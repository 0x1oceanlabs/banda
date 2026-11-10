//! Profile discovery, identity and creation. The store persists only the
//! connection this service validated; it never decides account policy.
use super::{AccountProfile, AccountStore, ConnectAccount, ConnectedAccount};
use crate::model::HarnessView;
use crate::{Harness, Harnesses};
use banda_kernel::Refusal;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub(super) struct Profiles {
    store: Arc<dyn AccountStore>,
    owned: PathBuf,
    harnesses: Harnesses,
    home: Option<PathBuf>,
    state_home: Option<PathBuf>,
    writing: Mutex<()>,
}

impl Profiles {
    pub fn remove(
        &self,
        id: &str,
        expected: Option<&str>,
        by: banda_kernel::Participant,
    ) -> Result<String, Refusal> {
        let _writing = self
            .writing
            .lock()
            .map_err(|_| Refusal::conflict("Account settings are busy."))?;
        let harness = self
            .harnesses
            .find(id)
            .ok_or_else(|| Refusal::not_found("That Account does not exist."))?;
        if harness.retired.is_some() {
            return self
                .harnesses
                .replacement(id)
                .map_err(Refusal::conflict)?
                .map(|(to, _)| to)
                .ok_or_else(|| Refusal::conflict("The Account's removal destination is missing."));
        }
        let (default, fallback) = self.store.selection()?;
        let to = default
            .or_else(|| {
                self.harnesses
                    .views()
                    .into_iter()
                    .find(|h| h.enabled)
                    .map(|h| h.id)
            })
            .ok_or_else(|| Refusal::conflict("Choose a default Account first."))?;
        if expected.is_some_and(|was| was != to) {
            return Err(Refusal::conflict(
                "The default Account changed. Review the removal again.",
            ));
        }
        if to == id {
            return Err(Refusal::conflict(
                "Choose another default Account before removing this one.",
            ));
        }
        self.harnesses.get(&to).map_err(Refusal::conflict)?;
        if self.harnesses.views().iter().any(|h| {
            self.harnesses
                .find(&h.id)
                .is_some_and(|h| h.of.as_deref() == Some(id))
        }) {
            return Err(Refusal::conflict(
                "Other Accounts inherit this Harness. Remove those Accounts first.",
            ));
        }
        self.store.retire(&super::PreparedRetirement {
            id: id.into(),
            to: to.clone(),
            by,
            clear_fallback: fallback.as_deref() == Some(id),
        })?;
        Ok(to)
    }

    pub fn new(owned: PathBuf, harnesses: Harnesses, store: Arc<dyn AccountStore>) -> Self {
        Self {
            store,
            owned,
            harnesses,
            home: std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(PathBuf::from),
            state_home: std::env::var_os("XDG_STATE_HOME").map(PathBuf::from),
            writing: Mutex::new(()),
        }
    }

    fn folder(&self, harness: &Harness) -> Option<PathBuf> {
        let (variable, default) = variable(harness.harness())?;
        harness
            .env
            .get(variable)
            .map(PathBuf::from)
            .or_else(|| std::env::var_os(variable).map(PathBuf::from))
            .or_else(|| self.home.as_ref().map(|h| h.join(default)))
    }

    fn connected(&self, harnesses: &[Harness]) -> HashMap<PathBuf, String> {
        let mut connected = HashMap::new();
        for harness in harnesses.iter().filter(|h| h.retired.is_none()) {
            let Some(folder) = self
                .folder(harness)
                .and_then(|p| dunce::canonicalize(p).ok())
            else {
                continue;
            };
            connected
                .entry(folder)
                .or_insert_with(|| harness.id.clone());
        }
        connected
    }
}

pub(super) fn variable(harness: &str) -> Option<(&'static str, &'static str)> {
    match harness {
        "claude" => Some(("CLAUDE_CONFIG_DIR", ".claude")),
        "codex" => Some(("CODEX_HOME", ".codex")),
        _ => None,
    }
}

/// Both automatic discovery and the connect picker use the same XDG rule.
pub(super) fn omarchy_root(home: &Path, state_home: Option<&Path>) -> PathBuf {
    state_home
        .filter(|p| p.is_absolute())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| home.join(".local/state"))
        .join("omarchy/agents/accounts")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

impl Profiles {
    pub fn profiles(&self) -> Result<Vec<AccountProfile>, Refusal> {
        let harnesses = self.harnesses.followed().0;
        let connected = self.connected(&harnesses);
        let mut profiles = Vec::new();
        for id in ["claude", "codex"] {
            let Some(harness) = harnesses.iter().find(|h| h.id == id) else {
                continue;
            };
            let mut folders = self.folder(harness).into_iter().collect::<Vec<_>>();
            if let Some(home) = &self.home {
                let root = omarchy_root(home, self.state_home.as_deref()).join(id);
                if let Ok(entries) = std::fs::read_dir(root) {
                    folders.extend(entries.flatten().map(|entry| entry.path()));
                }
                // Ordinary named homes, e.g. ~/.claude_second.
                if let Ok(entries) = std::fs::read_dir(home) {
                    folders.extend(
                        entries
                            .flatten()
                            .filter(|entry| {
                                entry
                                    .file_name()
                                    .to_string_lossy()
                                    .starts_with(&format!(".{id}_"))
                            })
                            .map(|entry| entry.path()),
                    );
                }
            }
            for folder in folders {
                let Ok(folder) = dunce::canonicalize(folder) else {
                    continue;
                };
                if !folder.is_dir()
                    || profiles
                        .iter()
                        .any(|p: &AccountProfile| p.folder == folder.to_string_lossy())
                {
                    continue;
                }
                profiles.push(AccountProfile {
                    harness: id.into(),
                    account: connected.get(&folder).cloned(),
                    folder: folder.to_string_lossy().into_owned(),
                });
            }
        }
        profiles.sort_by(|a, b| (&a.harness, &a.folder).cmp(&(&b.harness, &b.folder)));
        Ok(profiles)
    }

    pub fn connect(&self, account: ConnectAccount) -> Result<HarnessView, Refusal> {
        let _writing = self
            .writing
            .lock()
            .map_err(|_| Refusal::conflict("Account settings are busy after an error."))?;
        if !valid_id(&account.id) {
            return Err(Refusal::invalid(
                "An Account ID is 1–80 lowercase letters, digits and hyphens, starting with a letter or digit.",
            ));
        }
        let (variable, _) = variable(&account.harness).ok_or_else(|| {
            Refusal::invalid("Accounts can be connected to Claude Code or Codex.")
        })?;
        let harness = self
            .harnesses
            .get(&account.harness)
            .map_err(Refusal::invalid)?;
        if self.harnesses.find(&account.id).is_some() {
            return Err(Refusal::conflict("That Account ID is already registered."));
        }
        let name = account.name.unwrap_or_else(|| {
            format!(
                "{} {}",
                harness.name,
                self.harnesses
                    .views()
                    .iter()
                    .filter(|h| h.harness == harness.id)
                    .count()
                    + 1
            )
        });
        if name.trim().is_empty() || name.len() > 200 {
            return Err(Refusal::invalid(
                "An Account needs a name of at most 200 bytes.",
            ));
        }
        let made = account.folder.is_none();
        let folder = if let Some(folder) = account.folder {
            let folder = PathBuf::from(folder);
            if !folder.is_absolute() {
                return Err(Refusal::invalid(
                    "The profile folder must be an absolute path on the engine's machine.",
                ));
            }
            dunce::canonicalize(folder).map_err(|e| {
                Refusal::invalid(format!("The profile folder cannot be opened: {e}"))
            })?
        } else {
            std::fs::create_dir_all(&self.owned)
                .map_err(|e| Refusal::invalid(format!("Account folders cannot be created: {e}")))?;
            let folder = self.owned.join(&account.id);
            #[cfg(unix)]
            let made = {
                use std::os::unix::fs::DirBuilderExt;
                std::fs::DirBuilder::new().mode(0o700).create(&folder)
            };
            #[cfg(not(unix))]
            let made = std::fs::create_dir(&folder);
            made.map_err(|e| Refusal::conflict(format!("This Account's folder could not be created: {e}. Connect it explicitly if it already exists.")))?;
            dunce::canonicalize(folder).map_err(|e| Refusal::invalid(e.to_string()))?
        };
        if !folder.is_dir() {
            return Err(Refusal::invalid("A profile must be a folder."));
        }
        if let Some(id) = self.connected(&self.harnesses.followed().0).get(&folder) {
            return Err(Refusal::conflict(format!(
                "That folder is already connected as {id}."
            )));
        }
        let result = self.store.save(&ConnectedAccount {
            id: account.id.clone(),
            name: name.trim().into(),
            harness: account.harness,
            variable,
            folder: folder.clone(),
        });
        if let Err(error) = result {
            // A newly made, still-empty folder only; never remove an
            // adopted folder or provider data written concurrently.
            if made {
                let _ = std::fs::remove_dir(&folder);
            }
            return Err(error);
        }
        self.harnesses
            .views()
            .into_iter()
            .find(|h| h.id == account.id)
            .ok_or_else(|| {
                Refusal::conflict(
                    "The Account was saved but could not be read. Check harnesses.toml.",
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Store(PathBuf);
    impl AccountStore for Store {
        fn save(&self, account: &ConnectedAccount) -> Result<(), Refusal> {
            let path = self.0.join("harnesses.toml");
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|_| "[omarchy]\nenabled = false\n[[harness]]\nid = \"claude\"\n[[harness]]\nid = \"codex\"\n".into());
            let mut document: toml::Value = toml::from_str(&text).unwrap();
            let entry = serde_json::json!({"id":account.id, "name":account.name,
                "of":account.harness, "env":{account.variable:account.folder.to_string_lossy()}});
            document
                .as_table_mut()
                .unwrap()
                .entry("harness")
                .or_insert_with(|| toml::Value::Array(vec![]))
                .as_array_mut()
                .unwrap()
                .push(toml::Value::try_from(entry).unwrap());
            std::fs::write(path, toml::to_string(&document).unwrap())
                .map_err(|e| Refusal::invalid(e.to_string()))
        }
    }

    fn accounts(root: &Path) -> Profiles {
        let config = root.join("config");
        std::fs::create_dir_all(&config).unwrap();
        let list = Harnesses::load(&config.join("harnesses.toml")).unwrap();
        Profiles {
            home: Some(root.join("home")),
            state_home: None,
            ..Profiles::new(root.join("data/accounts"), list, Arc::new(Store(config)))
        }
    }

    fn add(id: &str, folder: Option<&Path>) -> ConnectAccount {
        ConnectAccount {
            harness: "claude".into(),
            id: id.into(),
            name: Some("Work".into()),
            folder: folder.map(|p| p.to_string_lossy().into_owned()),
        }
    }

    #[test]
    fn a_new_account_has_a_private_home_and_cannot_be_connected_twice() {
        let root = tempfile::tempdir().unwrap();
        let accounts = accounts(root.path());
        let view = accounts.connect(add("work", None)).unwrap();
        assert_eq!(view.harness, "claude");
        let folder = dunce::canonicalize(accounts.owned.join("work")).unwrap();
        assert!(folder.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        assert_eq!(
            accounts.harnesses.find("work").unwrap().env["CLAUDE_CONFIG_DIR"],
            folder.to_string_lossy()
        );
        assert!(accounts.connect(add("work", None)).is_err());
        assert!(accounts.connect(add("alias", Some(&folder))).is_err());
    }

    #[test]
    fn discovery_and_adoption_do_not_read_or_copy_credentials() {
        let root = tempfile::tempdir().unwrap();
        let accounts = accounts(root.path());
        let folder = accounts
            .home
            .as_ref()
            .unwrap()
            .join(".local/state/omarchy/agents/accounts/claude/c2");
        std::fs::create_dir_all(&folder).unwrap();
        let folder = dunce::canonicalize(folder).unwrap();
        let credentials = folder.join(".credentials.json");
        std::fs::write(&credentials, "not even JSON: never parsed here").unwrap();
        let profiles = accounts.profiles().unwrap();
        assert!(
            profiles
                .iter()
                .any(|p| p.folder == folder.to_string_lossy() && p.account.is_none())
        );
        accounts.connect(add("work", Some(&folder))).unwrap();
        assert_eq!(
            std::fs::read_to_string(credentials).unwrap(),
            "not even JSON: never parsed here"
        );
        assert!(!accounts.owned.exists());
        assert!(
            accounts
                .profiles()
                .unwrap()
                .iter()
                .any(|p| p.account.as_deref() == Some("work"))
        );
    }

    #[test]
    fn invalid_inputs_write_nothing() {
        let root = tempfile::tempdir().unwrap();
        let accounts = accounts(root.path());
        for id in ["", "..", "a.b", "../claude", "a/b", "UPPER", "a\"b"] {
            assert!(accounts.connect(add(id, None)).is_err(), "{id}");
        }
        assert!(
            accounts
                .connect(add("relative", Some(Path::new("relative"))))
                .is_err()
        );
        let mut custom = add("work", None);
        custom.harness = "sh".into();
        assert!(accounts.connect(custom).is_err());
        assert!(!root.path().join("config/harnesses.toml").exists());
        assert!(!accounts.owned.exists());
        assert!(
            serde_json::from_value::<ConnectAccount>(
                serde_json::json!({"id":"x", "harness":"claude", "command":"sh"})
            )
            .is_err()
        );
    }
    struct Refusing;
    impl AccountStore for Refusing {
        fn save(&self, _: &ConnectedAccount) -> Result<(), Refusal> {
            Err(Refusal::conflict("Settings changed while connecting."))
        }
    }
    #[test]
    fn a_failed_save_removes_only_a_new_empty_folder_and_allows_retry() {
        let root = tempfile::tempdir().unwrap();
        let mut accounts = accounts(root.path());
        let store = accounts.store.clone();
        accounts.store = Arc::new(Refusing);
        let error = accounts.connect(add("work", None)).err().unwrap();
        assert_eq!(error.message, "Settings changed while connecting.");
        assert!(!accounts.owned.join("work").exists());
        let adopted = root.path().join("adopted");
        std::fs::create_dir(&adopted).unwrap();
        std::fs::write(adopted.join("keep"), "provider data").unwrap();
        assert!(accounts.connect(add("adopted", Some(&adopted))).is_err());
        assert_eq!(
            std::fs::read_to_string(adopted.join("keep")).unwrap(),
            "provider data"
        );
        accounts.store = store;
        assert!(accounts.connect(add("work", None)).is_ok());
    }

    #[test]
    fn a_failed_save_does_not_remove_data_written_by_the_provider() {
        struct Writing;
        impl AccountStore for Writing {
            fn save(&self, account: &ConnectedAccount) -> Result<(), Refusal> {
                std::fs::write(account.folder.join("keep"), "provider data").unwrap();
                Err(Refusal::conflict("Cannot save."))
            }
        }
        let root = tempfile::tempdir().unwrap();
        let mut accounts = accounts(root.path());
        accounts.store = Arc::new(Writing);
        assert!(accounts.connect(add("work", None)).is_err());
        assert_eq!(
            std::fs::read_to_string(accounts.owned.join("work/keep")).unwrap(),
            "provider data"
        );
    }
    #[test]
    fn discovery_uses_the_same_custom_state_root_as_automatic_accounts() {
        let root = tempfile::tempdir().unwrap();
        let mut accounts = accounts(root.path());
        let state = root.path().join("custom-state");
        accounts.state_home = Some(state.clone());
        let home = accounts.home.as_ref().unwrap();
        let folder = state.join("omarchy/agents/accounts/claude/c2");
        std::fs::create_dir_all(&folder).unwrap();
        let folder = dunce::canonicalize(folder).unwrap();
        assert!(
            accounts
                .profiles()
                .unwrap()
                .iter()
                .any(|p| p.folder == folder.to_string_lossy())
        );
        assert_eq!(
            omarchy_root(home, Some(Path::new("relative"))),
            home.join(".local/state/omarchy/agents/accounts")
        );
    }
}
