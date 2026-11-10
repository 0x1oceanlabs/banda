//! The Account operations use the existing comment-preserving settings
//! writer. Each creates exactly one profile variable, never a program or
//! arbitrary environment supplied by its caller (ADR 0104).
use banda_harnesses::accounts::{AccountProfile, AccountSettings, ConnectAccount};
use banda_harnesses::model::HarnessView;
use banda_harnesses::{Harness, Harnesses};
use banda_kernel::Refusal;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use toml_edit::{InlineTable, Value};

pub struct Accounts {
    config: PathBuf,
    owned: PathBuf,
    harnesses: Harnesses,
    home: Option<PathBuf>,
    writing: Mutex<()>,
}

impl Accounts {
    pub fn new(config: PathBuf, owned: PathBuf, harnesses: Harnesses) -> Self {
        Self {
            config,
            owned,
            harnesses,
            home: std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(PathBuf::from),
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

    fn connected(&self, folder: &Path) -> Option<String> {
        self.harnesses.views().iter().find_map(|view| {
            let harness = self.harnesses.find(&view.id)?;
            let home = dunce::canonicalize(self.folder(&harness)?).ok()?;
            (home == folder).then(|| view.id.clone())
        })
    }
}

fn variable(harness: &str) -> Option<(&'static str, &'static str)> {
    match harness {
        "claude" => Some(("CLAUDE_CONFIG_DIR", ".claude")),
        "codex" => Some(("CODEX_HOME", ".codex")),
        _ => None,
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

impl AccountSettings for Accounts {
    fn profiles(&self) -> Result<Vec<AccountProfile>, Refusal> {
        let mut profiles = Vec::new();
        for id in ["claude", "codex"] {
            let Some(harness) = self.harnesses.find(id) else {
                continue;
            };
            let mut folders = self.folder(&harness).into_iter().collect::<Vec<_>>();
            if let Some(home) = &self.home {
                let root = home.join(".local/state/omarchy/agents/accounts").join(id);
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
                    account: self.connected(&folder),
                    folder: folder.to_string_lossy().into_owned(),
                });
            }
        }
        profiles.sort_by(|a, b| (&a.harness, &a.folder).cmp(&(&b.harness, &b.folder)));
        Ok(profiles)
    }

    fn connect(&self, account: ConnectAccount) -> Result<HarnessView, Refusal> {
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
        if let Some(id) = self.connected(&folder) {
            return Err(Refusal::conflict(format!(
                "That folder is already connected as {id}."
            )));
        }
        let mut env = InlineTable::new();
        env.insert(variable, Value::from(folder.to_string_lossy().into_owned()));
        let mut entry = InlineTable::new();
        entry.insert("name", Value::from(name.trim()));
        entry.insert("of", Value::from(account.harness));
        entry.insert("env", Value::InlineTable(env));
        let result = crate::set(
            &self.config,
            "harnesses.toml",
            &format!("harness.{}", account.id),
            &Value::InlineTable(entry).to_string(),
        );
        if let Err(problems) = result {
            // A newly made, still-empty folder only; never remove an
            // adopted folder or provider data written concurrently.
            if made {
                let _ = std::fs::remove_dir(&folder);
            }
            return Err(Refusal::invalid(format!(
                "The Account could not be saved: {problems:?}"
            )));
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

    fn accounts(root: &Path) -> Accounts {
        let config = root.join("config");
        std::fs::create_dir_all(&config).unwrap();
        let list = Harnesses::load(&config.join("harnesses.toml")).unwrap();
        Accounts {
            home: Some(root.join("home")),
            ..Accounts::new(config, root.join("data/accounts"), list)
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
    fn a_new_account_has_a_private_home_and_keeps_existing_settings() {
        let root = tempfile::tempdir().unwrap();
        let accounts = accounts(root.path());
        std::fs::write(
            accounts.config.join("harnesses.toml"),
            "# Keep this comment\n[[harness]]\nid = \"claude\"\n[limits]\nread = false\n",
        )
        .unwrap();
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
        let saved = std::fs::read_to_string(accounts.config.join("harnesses.toml")).unwrap();
        assert!(saved.contains("# Keep this comment"));
        assert!(saved.contains("read = false"));
        assert!(saved.contains("CLAUDE_CONFIG_DIR"));
        assert!(!saved.contains("command ="));
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
        assert!(!accounts.config.join("harnesses.toml").exists());
        assert!(!accounts.owned.exists());
        assert!(
            serde_json::from_value::<ConnectAccount>(
                serde_json::json!({"id":"x", "harness":"claude", "command":"sh"})
            )
            .is_err()
        );
    }
}
