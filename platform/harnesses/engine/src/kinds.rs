//! What differs between the Harnesses Banda knows, one row each (ADR 0108,
//! decision 6): where an account keeps its sign-in, where its sessions
//! and journals are, how it reaches a gateway, and how it signs in. The
//! rest of the module asks the row, never a Harness's name.

use crate::Harness;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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
    /// Whether its CLI's `login` signs in by itself in a terminal: on a
    /// page it names, or with a code shown on another computer.
    pub device_code: bool,
    /// The variable that names to its adapter the folder in a Project's
    /// `data` its sessions go in, one for every account of it, so any of
    /// them goes on with a Thread's session (ADR 0078, decision 3); else
    /// they stay in each account's home.
    pub sessions: Option<&'static str>,
    /// The variable of its configuration that sets what its shells get,
    /// which its shells do not inherit from its own environment.
    pub shells: Option<&'static str>,
    /// Whether an account's home of its own shadows its Harness's, to share
    /// its sessions ([`crate::shadow`]; ADR 0078, decision 3).
    pub shadows: bool,
    /// Who makes it, as a setup's step says: "from Anthropic".
    pub vendor: &'static str,
    /// What a Person signs in to it with, as a setup's step says: "your
    /// Claude account".
    pub account: &'static str,
    /// Its vendor's own installer, which puts its CLI in the Person's
    /// folders with no administrator's right (ADR 0140, decision 3).
    pub install: Install,
}

/// A vendor's installer, as one line of the system's shell: `sh` on Linux
/// and macOS, PowerShell on Windows.
pub(crate) struct Install {
    pub unix: &'static str,
    pub windows: &'static str,
}

impl Install {
    /// The line for this system.
    pub(crate) const fn here(&self) -> &'static str {
        if cfg!(windows) {
            self.windows
        } else {
            self.unix
        }
    }
}

/// Git's install on this system (ADR 0140, decision 5): the one step that
/// may ask the system for a right, each in the system's own dialog.
/// - Windows: winget, for the Person alone where it allows it, else for
///   the machine, which Windows asks to allow.
/// - macOS: Apple's own tools, in Apple's dialog, waited for.
/// - Linux: the system's package manager through `pkexec`, which asks for
///   the password in a dialog of its own.
pub(crate) const GIT: &str = if cfg!(windows) {
    "$a = 'install','--id','Git.Git','-e','--source','winget','--silent',\
     '--accept-package-agreements','--accept-source-agreements','--disable-interactivity'; \
     winget @a --scope user; if ($LASTEXITCODE -ne 0) { winget @a }; exit $LASTEXITCODE"
} else if cfg!(target_os = "macos") {
    "xcode-select --install 2>&1; echo 'Waiting for Apple’s installer to finish.'; \
     until [ -x \"$(xcode-select -p 2>/dev/null)/usr/bin/git\" ]; do sleep 5; done"
} else {
    "say() { echo \"Install Git with your system's package manager, then try again.\"; exit 1; }; \
     command -v pkexec >/dev/null || say; \
     if command -v apt-get >/dev/null; then pkexec apt-get install -y git; \
     elif command -v dnf >/dev/null; then pkexec dnf install -y git; \
     elif command -v pacman >/dev/null; then pkexec pacman -S --noconfirm --needed git; \
     elif command -v zypper >/dev/null; then pkexec zypper --non-interactive install git; \
     else say; fi"
};

/// A `git` on this computer, with none run to look: on macOS `/usr/bin/git`
/// is a stub that opens Apple's installer when it runs, and counts only
/// once Apple's tools are there.
pub(crate) fn git() -> Option<std::path::PathBuf> {
    let found = banda_kernel::host::programs("git".as_ref(), &banda_kernel::host::path());
    let stub = |path: &Path| {
        cfg!(target_os = "macos")
            && path == Path::new("/usr/bin/git")
            && ![
                "/Library/Developer/CommandLineTools",
                "/Applications/Xcode.app/Contents/Developer",
            ]
            .iter()
            .any(|tools| Path::new(tools).join("usr/bin/git").is_file())
    };
    found.into_iter().find(|path| !stub(path))
}

/// The program that runs `line`, an installer's, in this system's shell:
/// the Person's own, outside the fence, as they asked for it.
pub(crate) fn installer(line: &str) -> banda_kernel::Program {
    let (shell, args): (&str, &[&str]) = if cfg!(windows) {
        (
            "powershell.exe",
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"],
        )
    } else {
        ("sh", &["-c"])
    };
    let args = args.iter().copied().chain([line]).map(str::to_owned);
    banda_kernel::Program::act(shell, args.collect())
}

impl Row {
    /// The home `env` names: its variable, else the engine's own, else its
    /// folder in `person`'s home.
    pub(crate) fn home(
        &self,
        env: &BTreeMap<String, String>,
        person: Option<&Path>,
    ) -> Option<PathBuf> {
        let named = |home: Option<String>| home.filter(|home| !home.is_empty()).map(PathBuf::from);
        (named(env.get(self.home).cloned()))
            .or_else(|| named(std::env::var(self.home).ok()))
            .or_else(|| Some(person?.join(self.default_home)))
    }
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
    sessions: Some("BANDA_CLAUDE_SESSIONS"),
    shells: None,
    shadows: false,
    vendor: "Anthropic",
    account: "Claude",
    install: Install {
        unix: "curl -fsSL https://claude.ai/install.sh | bash",
        windows: "irm https://claude.ai/install.ps1 | iex",
    },
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
    sessions: None,
    shells: Some(CODEX_CONFIG),
    shadows: true,
    vendor: "OpenAI",
    account: "ChatGPT",
    install: Install {
        unix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        windows: "irm https://chatgpt.com/codex/install.ps1 | iex",
    },
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
