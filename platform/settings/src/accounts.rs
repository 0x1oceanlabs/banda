//! Persistence adapter for Accounts. Account policy and folder lifetimes
//! belong to banda_harnesses::accounts; this only preserves settings text.
use banda_harnesses::accounts::{AccountStore, ConnectedAccount};
use banda_kernel::Refusal;
use std::path::PathBuf;
use toml_edit::{InlineTable, Value};

pub struct Store {
    config: PathBuf,
}
impl Store {
    pub fn new(config: PathBuf) -> Self {
        Self { config }
    }
}
impl AccountStore for Store {
    fn selection(&self) -> Result<(Option<String>, Option<String>), Refusal> {
        let path = self.config.join("agents.toml");
        let settings = if path.exists() {
            let text =
                std::fs::read_to_string(&path).map_err(|e| Refusal::invalid(e.to_string()))?;
            let mut problems = Vec::new();
            let settings = banda_look::file::read::<banda_agents::sending::AgentsSettings>(
                &path,
                &text,
                &mut problems,
            );
            if !problems.is_empty() {
                return Err(Refusal::invalid(
                    "Fix agents.toml before removing an Account.",
                ));
            }
            settings
                .ok_or_else(|| Refusal::invalid("Fix agents.toml before removing an Account."))?
        } else {
            Default::default()
        };
        let start = settings.start.unwrap_or_default();
        Ok((start.account, start.fallback))
    }
    fn retire(
        &self,
        retirement: &banda_harnesses::accounts::PreparedRetirement,
    ) -> Result<(), Refusal> {
        let (id, to, by, clear_fallback) = retirement.entry();
        // Clear the fallback before retirement. A failed second write leaves
        // the Account usable and reports the problem; repeating is safe.
        if clear_fallback {
            crate::reset(&self.config, "agents.toml", "start.fallback")
                .map_err(|e| Refusal::invalid(format!("Could not clear the fallback: {e:?}")))?;
        }
        let mut author = InlineTable::new();
        let (kind, id_of_author) = match by {
            banda_kernel::Participant::Person(id) => ("person", id.to_string()),
            banda_kernel::Participant::Agent(id) => ("agent", id.to_string()),
        };
        author.insert("kind", Value::from(kind));
        author.insert("id", Value::from(id_of_author));
        let mut retired = InlineTable::new();
        retired.insert("to", Value::from(to));
        retired.insert("by", Value::InlineTable(author));
        let value = Value::InlineTable(retired);
        crate::set(
            &self.config,
            "harnesses.toml",
            &format!("harness.{}.retired", Value::from(id)),
            &value.to_string(),
        )
        .map_err(|e| Refusal::invalid(format!("Could not remove the Account: {e:?}")))?;
        Ok(())
    }

    fn save(&self, account: &ConnectedAccount) -> Result<(), Refusal> {
        let (variable, folder) = account.profile();
        let mut env = InlineTable::new();
        env.insert(variable, Value::from(folder.to_string_lossy().into_owned()));
        let mut entry = InlineTable::new();
        entry.insert("name", Value::from(account.name()));
        entry.insert("of", Value::from(account.harness()));
        entry.insert("env", Value::InlineTable(env));
        crate::set(
            &self.config,
            "harnesses.toml",
            &format!("harness.{}", account.id()),
            &Value::InlineTable(entry).to_string(),
        )
        .map_err(|problems| {
            Refusal::invalid(format!("The Account could not be saved: {problems:?}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_harnesses::{
        Harnesses,
        accounts::{Accounts, ConnectAccount},
    };
    use std::sync::Arc;

    #[test]
    fn connecting_uses_the_writer_and_preserves_existing_settings() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config");
        std::fs::create_dir(&config).unwrap();
        let path = config.join("harnesses.toml");
        std::fs::write(
            &path,
            "# Keep this comment\n[omarchy]\nenabled = false\n[limits]\nread = false\n[[harness]]\nid = \"claude\"\n",
        )
        .unwrap();
        let harnesses = Harnesses::load(&path).unwrap();
        let accounts = Accounts::new(harnesses.clone())
            .with_store(root.path().join("accounts"), Arc::new(Store::new(config)));
        let view = accounts
            .connect(ConnectAccount {
                harness: "claude".into(),
                id: "work".into(),
                name: Some("Work".into()),
                folder: None,
            })
            .unwrap();
        assert_eq!(view.id, "work");
        let saved = std::fs::read_to_string(path).unwrap();
        assert!(saved.contains("# Keep this comment"));
        assert!(saved.contains("read = false"));
        assert!(saved.contains("CLAUDE_CONFIG_DIR"));
        assert!(!saved.contains("command ="));
        assert_eq!(
            harnesses.find("work").unwrap().env["CLAUDE_CONFIG_DIR"],
            dunce::canonicalize(root.path().join("accounts/work"))
                .unwrap()
                .to_string_lossy()
        );
    }
    fn add(id: &str, folder: Option<&std::path::Path>) -> ConnectAccount {
        ConnectAccount {
            harness: "claude".into(),
            id: id.into(),
            name: Some("Work".into()),
            folder: folder.map(|p| p.to_string_lossy().into_owned()),
        }
    }
    #[test]
    fn removal_keeps_provenance_and_profiles_and_validates_the_destination() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config");
        std::fs::create_dir_all(&config).unwrap();
        let harnesses = Harnesses::load(&config.join("harnesses.toml")).unwrap();
        let owned = root.path().join("accounts");
        let accounts = Accounts::new(harnesses.clone())
            .with_store(owned.clone(), Arc::new(Store::new(config.clone())));
        accounts.connect(add("work", None)).unwrap();
        accounts.connect(add("spare", None)).unwrap();
        let by = banda_kernel::Participant::Agent(banda_kernel::AgentId::new());
        let settings = config.join("agents.toml");
        std::fs::write(
            &settings,
            "[start]\naccount = \"work\"\nfallback = \"spare\"\n",
        )
        .unwrap();
        assert!(
            accounts.remove("work", None, by).is_err(),
            "the default cannot remove itself"
        );
        assert!(
            accounts.remove("claude", None, by).is_err(),
            "inherited programs stay"
        );
        let credentials = owned.join("spare/.credentials.json");
        std::fs::write(&credentials, "kept untouched").unwrap();
        assert!(
            accounts.remove("spare", Some("claude"), by).is_err(),
            "stale confirmation writes nothing"
        );
        assert_eq!(accounts.remove("spare", None, by).unwrap(), "work");
        assert_eq!(
            accounts.remove("spare", None, by).unwrap(),
            "work",
            "idempotent"
        );
        assert!(harnesses.get("spare").is_err());
        assert!(!harnesses.views().iter().any(|h| h.id == "spare"));
        assert_eq!(
            harnesses.replacement("spare").unwrap(),
            Some(("work".into(), by))
        );
        assert!(
            harnesses.find("spare").is_some(),
            "old sessions keep their source"
        );
        assert_eq!(
            std::fs::read_to_string(credentials).unwrap(),
            "kept untouched"
        );
        assert!(
            !std::fs::read_to_string(settings)
                .unwrap()
                .contains("fallback")
        );
        assert!(
            accounts.connect(add("spare", None)).is_err(),
            "an old ID cannot name a different session source"
        );
        let mut reconnected = add("spare-again", None);
        reconnected.folder = Some(owned.join("spare").to_string_lossy().into_owned());
        assert!(
            accounts.connect(reconnected).is_ok(),
            "a retired folder can be adopted under a new ID"
        );
    }
}
