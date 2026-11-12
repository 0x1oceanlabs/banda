//! What differs between the Harnesses Banda knows, one row each (ADR 0108,
//! decision 6): where an account keeps its sign-in, where its sessions
//! and journals are, how it reaches a gateway, and how it signs in. The
//! rest of the module asks the row, never a Harness's name.

use crate::Harness;
use serde_json::{Map, Value};

/// What Codex's adapter takes as Codex's configuration for each of its
/// sessions: a JSON object, whose keys may be dotted paths, as Codex's
/// `-c` takes them.
pub(crate) const CODEX_CONFIG: &str = "CODEX_CONFIG";

/// The provider a Codex gateway account names for itself.
pub(crate) const CODEX_PROVIDER: &str = "banda-gateway";

/// How long Codex waits for `banda secret get`: a key kept as a reference
/// may wait for its password manager to be unlocked (ADR 0078, decision 1).
pub(crate) const SECRET_WAIT_MS: u64 = 60_000;

/// A Harness Banda knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Claude,
    Codex,
}

/// What a Harness Banda knows does its own way.
pub(crate) struct Row {
    /// Its ID, as its built-in entry's.
    pub id: &'static str,
    /// The variable that names an account's home, where it keeps its
    /// sign-in, and that home's folder in the Person's by default.
    pub home: &'static str,
    pub default_home: &'static str,
    /// The variable that tells its adapter where its CLI is.
    pub cli: &'static str,
    /// The folder of its home its journals are in.
    pub journals: &'static str,
    /// The way that signs in an account billed by the token (ADR 0078,
    /// decision 1), when its Harness has one; else its CLI takes the key
    /// itself, on stdin.
    pub api_way: Option<&'static str>,
    /// Whether a gateway account asks Banda for its key with a helper its
    /// home's settings name, as Claude Code's `apiKeyHelper`; else its
    /// gateway's configuration says how ([`Kind::gateway`]).
    pub key_helper: bool,
    /// Whether its CLI signs in with a code shown on another computer.
    pub device_code: bool,
}

pub(crate) const CLAUDE: Row = Row {
    id: "claude",
    home: "CLAUDE_CONFIG_DIR",
    default_home: ".claude",
    cli: "CLAUDE_CODE_EXECUTABLE",
    journals: "projects",
    api_way: Some("console-login"),
    key_helper: true,
    device_code: false,
};

pub(crate) const CODEX: Row = Row {
    id: "codex",
    home: "CODEX_HOME",
    default_home: ".codex",
    cli: "CODEX_PATH",
    journals: "sessions",
    api_way: None,
    key_helper: false,
    device_code: true,
};

impl Kind {
    /// Every Harness Banda knows.
    pub(crate) const ALL: [Kind; 2] = [Kind::Claude, Kind::Codex];

    /// Its row.
    pub(crate) const fn row(self) -> &'static Row {
        match self {
            Kind::Claude => &CLAUDE,
            Kind::Codex => &CODEX,
        }
    }

    /// The Harness whose ID is `id`.
    pub(crate) fn named(id: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|kind| kind.row().id == id)
    }

    /// What `harness` runs: the Harness it is an account of (ADR 0078),
    /// else the CLI its adapter is told of, by the variable or the
    /// program's name, else its ID. So a second account, an entry of its
    /// own with Claude Code's adapter, is Claude Code's.
    pub(crate) fn of(harness: &Harness) -> Option<Kind> {
        if let Some(kind) = harness.of.as_deref().and_then(Kind::named) {
            return Some(kind);
        }
        let Some(cli) = &harness.cli else {
            return Kind::named(&harness.id);
        };
        let told = Kind::ALL
            .into_iter()
            .find(|kind| kind.row().cli == cli.variable);
        let program = std::path::Path::new(&cli.program).file_stem();
        told.or_else(|| Kind::named(program?.to_str()?))
    }

    /// The ID Banda knows it by, as its built-in entry's.
    pub(crate) fn id(self) -> &'static str {
        self.row().id
    }

    /// Sends `harness`'s requests to the gateway at `url` (ADR 0078,
    /// decision 1): Claude Code there, asking for its key with the
    /// `apiKeyHelper` its folder's settings name; Codex through a provider
    /// of its own there, over its entry's `CODEX_CONFIG`, chosen for its
    /// sessions, whose token it asks `banda secret get <id>` for. Neither
    /// gets the key.
    pub(crate) fn gateway(self, harness: &mut Harness, url: &str) -> Result<(), String> {
        match self {
            Kind::Claude => {
                (harness.env).insert("ANTHROPIC_BASE_URL".to_owned(), url.to_owned());
            }
            Kind::Codex => {
                let mut config = match harness
                    .env
                    .get(CODEX_CONFIG)
                    .map(|c| serde_json::from_str(c))
                {
                    None => Map::new(),
                    Some(Ok(Value::Object(config))) => config,
                    Some(_) => {
                        return Err("a gateway's `CODEX_CONFIG` is a JSON object".to_owned());
                    }
                };
                let key = |k: &str| format!("model_providers.{CODEX_PROVIDER}.{k}");
                config.insert("model_provider".to_owned(), CODEX_PROVIDER.into());
                config.insert(key("name"), harness.name.as_str().into());
                config.insert(key("base_url"), url.into());
                config.insert(key("wire_api"), "responses".into());
                config.insert(key("auth.command"), "banda".into());
                config.insert(
                    key("auth.args"),
                    serde_json::json!(["secret", "get", harness.id]),
                );
                config.insert(key("auth.timeout_ms"), SECRET_WAIT_MS.into());
                (harness.env).insert(CODEX_CONFIG.to_owned(), Value::Object(config).to_string());
                // What Codex's adapter starts its sessions with.
                (harness.env).insert("MODEL_PROVIDER".to_owned(), CODEX_PROVIDER.to_owned());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_harness_is_named_by_its_id() {
        assert_eq!(Kind::named("claude"), Some(Kind::Claude));
        assert_eq!(Kind::named("CODEX_PATH"), None, "a variable is no ID");
        assert_eq!(Kind::named("pi"), None);
        for kind in Kind::ALL {
            assert_eq!(Kind::named(kind.id()), Some(kind));
        }
    }
}
