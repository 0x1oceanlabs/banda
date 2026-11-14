//! Persistence adapter for Accounts. Account policy and folder lifetimes
//! belong to banda_harnesses::accounts; this only preserves settings text.
use banda_harnesses::accounts::{AccountStore, ConnectedAccount, StartRole, UpdateAccount};
use banda_kernel::Refusal;
use std::collections::BTreeMap;
use std::path::PathBuf;
use toml_edit::{InlineTable, Value};

pub struct Store {
    settings: crate::Settings,
    config: PathBuf,
}
impl Store {
    pub fn new(settings: crate::Settings, config: PathBuf) -> Self {
        Self { settings, config }
    }

    /// `agents.toml` as it reads, its defaults when it is not there; none
    /// when it does not read.
    fn agents(&self) -> Option<banda_agents::sending::AgentsSettings> {
        let path = self.config.join("agents.toml");
        if !path.exists() {
            return Some(Default::default());
        }
        let text = std::fs::read_to_string(&path).ok()?;
        let mut problems = Vec::new();
        let settings = banda_look::file::read::<banda_agents::sending::AgentsSettings>(
            &path,
            &text,
            &mut problems,
        );
        settings.filter(|_| problems.is_empty())
    }
}
impl AccountStore for Store {
    fn selection(&self) -> Result<(Option<String>, Option<String>), Refusal> {
        let settings = self
            .agents()
            .ok_or_else(|| Refusal::invalid("Fix agents.toml before removing an Account."))?;
        let start = settings.start.unwrap_or_default();
        Ok((start.account, start.fallback))
    }
    fn models(&self) -> BTreeMap<String, Vec<String>> {
        (self.agents())
            .and_then(|settings| settings.models)
            .unwrap_or_default()
    }
    fn set_models(&self, harness: &str, models: &[String]) -> Result<(), Refusal> {
        let key = format!("models.{}", Value::from(harness));
        let what = "The menu of models could not be saved";
        if models.is_empty() {
            return written(self.settings.reset(&self.config, "agents.toml", &key), what);
        }
        let list: toml_edit::Array = models.iter().map(String::as_str).collect();
        written(
            self.settings.set(
                &self.config,
                "agents.toml",
                &key,
                &Value::Array(list).to_string(),
            ),
            what,
        )
    }
    fn retire(
        &self,
        retirement: &banda_harnesses::accounts::PreparedRetirement,
    ) -> Result<(), Refusal> {
        let (id, to, by, clear_fallback) = retirement.entry();
        // Clear the fallback before retirement. A failed second write leaves
        // the Account usable and reports the problem; repeating is safe.
        if clear_fallback {
            written(
                self.settings
                    .reset(&self.config, "agents.toml", "start.fallback"),
                "Could not clear the fallback",
            )?;
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
        written(
            self.settings.set(
                &self.config,
                "harnesses.toml",
                &format!("harness.{}.retired", Value::from(id)),
                &value.to_string(),
            ),
            "Could not remove the Account",
        )
    }

    fn save(&self, account: &ConnectedAccount) -> Result<(), Refusal> {
        let (variable, folder) = account.profile();
        let mut env = InlineTable::new();
        env.insert(variable, Value::from(folder.to_string_lossy().into_owned()));
        let mut entry = InlineTable::new();
        entry.insert("name", Value::from(account.name()));
        entry.insert("colour", Value::from(i64::from(account.colour())));
        if let Some(icon) = account.icon() {
            entry.insert("icon", Value::from(icon.word()));
        }
        entry.insert("of", Value::from(account.harness()));
        if account.kind() != banda_harnesses::model::AccountKind::Subscription {
            entry.insert("kind", Value::from(account.kind().as_str()));
        }
        if let Some(url) = account.url() {
            entry.insert("url", Value::from(url));
        }
        entry.insert("env", Value::InlineTable(env));
        written(
            self.settings.set(
                &self.config,
                "harnesses.toml",
                &format!("harness.{}", account.id()),
                &Value::InlineTable(entry).to_string(),
            ),
            "The Account could not be saved",
        )
    }

    fn update(&self, change: &UpdateAccount) -> Result<(), Refusal> {
        let what = "The Account could not be changed";
        let entry = format!("harness.{}", Value::from(change.harness.as_str()));
        // What it names in one write, so that lands whole or not at all.
        let mut named = InlineTable::new();
        if let Some(name) = &change.name {
            named.insert("name", Value::from(name.trim()));
        }
        if let Some(icon) = change.icon {
            named.insert("icon", Value::from(icon.word()));
        }
        if let Some(colour) = change.colour {
            named.insert("colour", Value::from(i64::from(colour)));
        }
        if change.enabled == Some(false) {
            named.insert("enabled", Value::from(false));
        }
        if !named.is_empty() {
            let value = Value::InlineTable(named).to_string();
            written(
                self.settings
                    .set(&self.config, "harnesses.toml", &entry, &value),
                what,
            )?;
        }
        // On is how an entry is when it says nothing.
        if change.enabled == Some(true) {
            let enabled = format!("{entry}.enabled");
            written(
                self.settings
                    .reset(&self.config, "harnesses.toml", &enabled),
                what,
            )?;
        }
        Ok(())
    }

    fn set_start(&self, role: StartRole, harness: Option<&str>) -> Result<(), Refusal> {
        let key = match role {
            StartRole::Account => "start.account",
            StartRole::Fallback => "start.fallback",
        };
        written(
            match harness {
                Some(id) => self.settings.set(
                    &self.config,
                    "agents.toml",
                    key,
                    &Value::from(id).to_string(),
                ),
                None => self.settings.reset(&self.config, "agents.toml", key),
            },
            "The account could not be chosen",
        )
    }
}

/// `result`, a refusal that says `what` went wrong and why.
fn written<E: std::fmt::Debug>(result: Result<(), E>, what: &str) -> Result<(), Refusal> {
    result.map_err(|problems| Refusal::invalid(format!("{what}: {problems:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_harnesses::{
        Harnesses,
        accounts::{Accounts, ConnectAccount, SetModels, SetStart},
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
        let accounts = Accounts::new(harnesses.clone()).with_store(
            root.path().join("accounts"),
            Arc::new(Store::new(crate::whole::WHOLE, config)),
            secrets(root.path()),
        );
        let view = accounts
            .connect(ConnectAccount {
                harness: "claude".into(),
                id: "work".into(),
                name: Some("Work".into()),
                colour: None,
                icon: None,
                kind: None,
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
    /// A list in `root` with Accounts kept in its files, and its path.
    fn listed(root: &std::path::Path) -> (Accounts, PathBuf) {
        let config = root.join("config");
        std::fs::create_dir(&config).unwrap();
        let path = config.join("harnesses.toml");
        let text = concat!(
            "# Keep this comment\n[omarchy]\nenabled = false\n",
            "[[harness]]\nid = \"claude\"\n",
        );
        std::fs::write(&path, text).unwrap();
        let harnesses = Harnesses::load(&path).unwrap();
        let accounts = Accounts::new(harnesses).with_store(
            root.join("accounts"),
            Arc::new(Store::new(crate::whole::WHOLE, config.clone())),
            secrets(root),
        );
        accounts.connect(add("work", None)).unwrap();
        (accounts, config)
    }

    fn change(id: &str) -> UpdateAccount {
        UpdateAccount {
            harness: id.into(),
            name: None,
            icon: None,
            colour: None,
            enabled: None,
        }
    }

    #[test]
    fn an_update_writes_what_it_names_and_keeps_the_rest() {
        let root = tempfile::tempdir().unwrap();
        let (accounts, config) = listed(root.path());
        let file = config.join("harnesses.toml");
        let view = accounts
            .update_account(UpdateAccount {
                name: Some(" Personal ".into()),
                icon: Some(banda_harnesses::model::Icon::Personal),
                colour: Some(3),
                ..change("work")
            })
            .unwrap();
        assert_eq!(view.name, "Personal");
        assert_eq!(view.icon, Some(banda_harnesses::model::Icon::Personal));
        assert_eq!(view.colour, 3);
        let saved = std::fs::read_to_string(&file).unwrap();
        assert!(saved.contains("# Keep this comment"), "{saved}");
        assert!(saved.contains("CLAUDE_CONFIG_DIR"), "{saved}");

        let off = UpdateAccount {
            enabled: Some(false),
            ..change("work")
        };
        assert!(!accounts.update_account(off).unwrap().enabled);
        let on = UpdateAccount {
            enabled: Some(true),
            ..change("work")
        };
        assert!(accounts.update_account(on).unwrap().enabled);
        let saved = std::fs::read_to_string(&file).unwrap();
        assert!(!saved.contains("enabled = false\n[[harness]]\nid = \"work\""));
    }

    #[test]
    fn an_update_refuses_what_is_not_there_or_not_a_name() {
        let root = tempfile::tempdir().unwrap();
        let (accounts, _) = listed(root.path());
        let missing = accounts.update_account(change("nobody")).err().unwrap();
        assert_eq!(missing.code, banda_kernel::Code::NotFound);
        let blank = UpdateAccount {
            name: Some("  ".into()),
            ..change("work")
        };
        assert!(accounts.update_account(blank).is_err());
        let colour = UpdateAccount {
            colour: Some(99),
            ..change("work")
        };
        assert!(accounts.update_account(colour).is_err());
    }

    #[test]
    fn the_default_and_the_fallback_are_chosen_and_taken_back() {
        let root = tempfile::tempdir().unwrap();
        let (accounts, config) = listed(root.path());
        let file = config.join("agents.toml");
        let pick = |role, harness: Option<&str>| {
            accounts.set_start(SetStart {
                role,
                harness: harness.map(str::to_owned),
            })
        };
        pick(StartRole::Account, Some("work")).unwrap();
        pick(StartRole::Fallback, Some("claude")).unwrap();
        let saved = std::fs::read_to_string(&file).unwrap();
        assert!(saved.contains("account = \"work\""), "{saved}");
        assert!(saved.contains("fallback = \"claude\""), "{saved}");
        pick(StartRole::Fallback, None).unwrap();
        let saved = std::fs::read_to_string(&file).unwrap();
        // The template's comment names the key too.
        assert!(!saved.contains("\nfallback ="), "{saved}");
        assert!(pick(StartRole::Account, Some("nobody")).is_err());
    }

    #[test]
    fn a_harness_s_menu_of_models_is_written_read_and_taken_back() {
        let root = tempfile::tempdir().unwrap();
        let (accounts, config) = listed(root.path());
        let file = config.join("agents.toml");
        let set = |harness: &str, models: &[&str]| {
            accounts.set_models(SetModels {
                harness: harness.to_owned(),
                models: models.iter().map(|one| (*one).to_owned()).collect(),
            })
        };
        // Each model once, in the order given.
        set("claude", &["opus", " haiku ", "opus"]).unwrap();
        let saved = std::fs::read_to_string(&file).unwrap();
        assert!(saved.contains("claude = [\"opus\", \"haiku\"]"), "{saved}");
        let read = accounts.list(0);
        let claude = read.harnesses.iter().find(|h| h.id == "claude").unwrap();
        assert_eq!(claude.models, ["opus", "haiku"]);
        // None: the Harness's first three again.
        set("claude", &[]).unwrap();
        let read = accounts.list(0);
        let claude = read.harnesses.iter().find(|h| h.id == "claude").unwrap();
        assert!(claude.models.is_empty());
        // Only a Harness some account is of, and only named models.
        assert!(set("nobody", &["opus"]).is_err());
        assert!(set("claude", &[" "]).is_err());
    }

    #[test]
    fn an_emblem_is_written_with_its_account() {
        let root = tempfile::tempdir().unwrap();
        let (accounts, config) = listed(root.path());
        let view = accounts
            .connect(ConnectAccount {
                icon: Some(banda_harnesses::model::Icon::Spare),
                ..add("spare", None)
            })
            .unwrap();
        assert_eq!(view.icon, Some(banda_harnesses::model::Icon::Spare));
        let saved = std::fs::read_to_string(config.join("harnesses.toml")).unwrap();
        assert!(saved.contains("icon = \"spare\""), "{saved}");
    }

    /// Secrets kept in files under `root`: these accounts have none.
    fn secrets(root: &std::path::Path) -> banda_harnesses::Secrets {
        banda_harnesses::Secrets::with_keyring("banda-test", root.join("secrets"), None)
    }

    fn add(id: &str, folder: Option<&std::path::Path>) -> ConnectAccount {
        ConnectAccount {
            harness: "claude".into(),
            id: id.into(),
            name: Some("Work".into()),
            colour: None,
            icon: None,
            kind: None,
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
        let accounts = Accounts::new(harnesses.clone()).with_store(
            owned.clone(),
            Arc::new(Store::new(crate::whole::WHOLE, config.clone())),
            secrets(root.path()),
        );
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
