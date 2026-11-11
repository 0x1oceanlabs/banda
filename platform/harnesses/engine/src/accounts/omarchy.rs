//! Omarchy's display-safe Account registry and installed ACP programs.
//! No credential file is opened and no command is run during discovery.
use crate::Harness;
use banda_kernel::host;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(crate) struct Omarchy {
    home: PathBuf,
    state: PathBuf,
    programs: Vec<(String, String, PathBuf)>,
}

#[derive(Deserialize)]
struct Registry {
    accounts: Vec<Account>,
}
#[derive(Deserialize)]
struct Account {
    id: String,
    label: String,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    home: String,
}

impl Omarchy {
    /// The folder its accounts are listed in.
    pub(crate) fn folder(&self) -> &Path {
        &self.state
    }

    #[cfg(test)]
    pub(crate) fn fixture(home: PathBuf, state: PathBuf) -> Self {
        Self {
            home,
            state,
            programs: vec![],
        }
    }

    pub fn on_host() -> Option<Self> {
        if !cfg!(target_os = "linux") || !Path::new("/usr/share/omarchy").is_dir() {
            return None;
        }
        let home = dirs::home_dir()?;
        let state_home = std::env::var_os("XDG_STATE_HOME").map(PathBuf::from);
        let state = super::profiles::omarchy_root(&home, state_home.as_deref());
        let mise = home.join(".local/share/mise/installs");
        let programs = [
            (
                "opencode",
                "OpenCode",
                "opencode/latest/node_modules/.bin/opencode",
                "opencode",
            ),
            ("oh-my-pi", "Oh My Pi", "oh-my-pi/latest/omp", "omp"),
            (
                "pi",
                "Pi",
                "pi-acp/latest/node_modules/.bin/pi-acp",
                "pi-acp",
            ),
        ]
        .into_iter()
        .filter_map(|(id, name, installed, command)| {
            let installed = mise.join(installed);
            let path = if host::runnable(&installed) {
                Some(installed)
            } else {
                host::find(command, &host::path()).filter(|p| {
                    // A mise lazy shim does not mean its agent is installed.
                    !p.starts_with(home.join(".local/share/mise/shims"))
                })
            }?;
            Some((id.to_owned(), name.to_owned(), path))
        })
        .collect();
        Some(Self {
            home,
            state,
            programs,
        })
    }

    pub fn merge(&self, mut list: Vec<Harness>) -> Vec<Harness> {
        // A custom-only list (including a trial's fake Harness) is explicit.
        if !list.iter().any(|h| h.id == "claude" || h.id == "codex") {
            return list;
        }
        for (id, name, path) in &self.programs {
            if list.iter().any(|h| h.id == *id) {
                continue;
            }
            // Use a registered built-in as the structural base; never take a
            // program, arguments or environment from Omarchy's JSON registry.
            let Some(mut harness) = crate::list::known().into_iter().find(|h| h.id == "claude")
            else {
                continue;
            };
            harness.id = id.clone();
            harness.name = name.clone();
            harness.short = None;
            harness.command = path.display().to_string();
            harness.args = if id == "pi" {
                vec![]
            } else {
                vec!["acp".into()]
            };
            harness.cli = None;
            harness.carried = None;
            list.push(harness);
        }
        for provider in ["claude", "codex"] {
            let (variable, default) = super::profiles::variable(provider).unwrap();
            let Some(base) = list
                .iter()
                .find(|h| h.id == provider && h.of.is_none() && h.enabled)
                .cloned()
            else {
                continue;
            };
            // A manually chosen profile or custom start is independent of
            // Omarchy, including isolated test Harnesses and API Accounts.
            if base.env.contains_key(variable)
                || base.carried.is_none()
                || base.kind != crate::model::AccountKind::Subscription
            {
                continue;
            }
            let path = self.state.join(format!("{provider}.json"));
            // Bound metadata input. Broken or partially saved registries do
            // not stop Banda or affect another provider's Accounts.
            let Some(registry) = std::fs::metadata(&path)
                .ok()
                .filter(|m| m.len() <= 1024 * 1024)
                .and_then(|_| std::fs::read_to_string(&path).ok())
                .and_then(|s| serde_json::from_str::<Registry>(&s).ok())
            else {
                continue;
            };
            for account in registry.accounts {
                if account.id.is_empty()
                    || !account
                        .id
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
                {
                    continue;
                }
                let expected = if account.primary {
                    self.home.join(default)
                } else {
                    self.state.join(provider).join(&account.id)
                };
                let folder = if account.home.is_empty() {
                    expected.clone()
                } else {
                    PathBuf::from(&account.home)
                };
                if !folder.is_dir() || !same_folder(&folder, &expected) {
                    continue;
                }
                let name = if account.label.trim().is_empty() {
                    account.id.clone()
                } else {
                    account.label
                };
                if account.primary {
                    let current = list.iter_mut().find(|h| h.id == provider).unwrap();
                    if current.env.contains_key(variable) {
                        continue;
                    }
                    current
                        .env
                        .insert(variable.into(), folder.display().to_string());
                    if current.name == base.name
                        && Some(current.name.as_str()) == crate::list::program(provider)
                    {
                        current.name = name;
                    }
                    continue;
                }
                let id = format!("omarchy-{provider}-{}", account.id);
                if list.iter().any(|h| {
                    h.id == id
                        || (h.harness() == provider
                            && h.env
                                .get(variable)
                                .is_some_and(|p| same_folder(Path::new(p), &folder)))
                }) {
                    continue;
                }
                let mut harness = base.clone();
                harness.id = id;
                harness.of = Some(provider.into());
                harness.name = name;
                harness.mark = None;
                harness.colour = None;
                harness
                    .env
                    .insert(variable.into(), folder.display().to_string());
                // Omarchy already shares its Codex homes; discovery must not
                // rewrite those folders as Banda-created shadow homes.
                harness.shadows = None;
                list.push(harness);
            }
        }
        list
    }
}

fn same_folder(a: &Path, b: &Path) -> bool {
    match (dunce::canonicalize(a), dunce::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Omarchy) {
        let dir = tempfile::tempdir().unwrap();
        let discovery = Omarchy {
            home: dir.path().join("home"),
            state: dir.path().join("state/accounts"),
            programs: vec![],
        };
        std::fs::create_dir_all(discovery.home.join(".claude")).unwrap();
        std::fs::create_dir_all(discovery.state.join("claude/c2")).unwrap();
        (dir, discovery)
    }
    fn registry(d: &Omarchy, text: &str) {
        std::fs::write(d.state.join("claude.json"), text).unwrap();
    }
    fn known() -> Vec<Harness> {
        crate::list::known()
    }
    #[test]
    fn accounts_refresh_without_copying_credentials_or_following_active() {
        let (_dir, d) = setup();
        let text = r#"{"active":"c2","accounts":[{"id":"c1","label":"C1","primary":true},{"id":"c2","label":"C2"}]}"#;
        // Omarchy records an explicit home for added Accounts.
        let mut value: serde_json::Value = serde_json::from_str(text).unwrap();
        value["accounts"][1]["home"] = d.state.join("claude/c2").display().to_string().into();
        registry(&d, &value.to_string());
        let list = d.merge(known());
        assert_eq!(
            list.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(),
            ["claude", "codex", "omarchy-claude-c2"]
        );
        assert_eq!(list[0].name, "C1");
        assert_eq!(list[2].name, "C2");
        assert_eq!(list[2].carried, list[0].carried);
        assert_eq!(list[2].harness(), "claude");
        assert!(!d.state.join("claude/c2/.credentials.json").exists());
        registry(&d, r#"{"accounts":[]}"#);
        assert_eq!(d.merge(known()).len(), 2);
    }
    #[test]
    fn manual_accounts_and_disabled_harnesses_win() {
        let (_dir, d) = setup();
        registry(&d, r#"{"accounts":[{"id":"c2","label":"C2"}]}"#);
        let mut list = known();
        let mut manual = list[0].clone();
        manual.id = "work".into();
        manual.of = Some("claude".into());
        manual.enabled = false;
        manual.env.insert(
            "CLAUDE_CONFIG_DIR".into(),
            d.state.join("claude/c2").display().to_string(),
        );
        list.push(manual);
        assert_eq!(d.merge(list).len(), 3);
        let mut list = known();
        list[0].enabled = false;
        assert_eq!(d.merge(list).len(), 2);
        let mut list = known();
        list[0]
            .env
            .insert("CLAUDE_CONFIG_DIR".into(), "/manual/account".into());
        assert_eq!(
            d.merge(list).len(),
            2,
            "an explicit profile is independent of Omarchy"
        );
    }
    #[test]
    fn malformed_registry_and_escaping_paths_are_ignored() {
        let (_dir, d) = setup();
        registry(&d, "broken");
        assert_eq!(d.merge(known()).len(), 2);
        registry(
            &d,
            r#"{"accounts":[{"id":"../other","label":"bad"},{"id":"c2","label":"bad","home":"/tmp"}]}"#,
        );
        assert_eq!(d.merge(known()).len(), 2);
    }
    #[test]
    fn installed_acp_programs_do_not_override_explicit_entries() {
        let (_dir, mut d) = setup();
        d.programs.push((
            "opencode".into(),
            "OpenCode".into(),
            PathBuf::from("/installed/opencode"),
        ));
        let mut list = d.merge(known());
        assert_eq!(list[2].args, ["acp"]);
        assert!(list[2].carried.is_none());
        list[2].enabled = false;
        assert!(!d.merge(list)[2].enabled);
    }
}
