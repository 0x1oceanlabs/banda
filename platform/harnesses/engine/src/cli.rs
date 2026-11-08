//! The Person's own CLI that a Harness's adapter runs instead of a copy of
//! its own (ADR 0003, decision 3): Claude Code's `claude`, Codex's `codex`.
//! Each time the Harness starts, the engine finds the CLI and asks its
//! version, in the environment the Harness starts in (ADR 0084, decision
//! 5); a CLI that is not there stops the start, so Banda never runs a
//! bundled one in its place. A CLI older than the entry's `minimum` runs,
//! with a warning (ADR 0003, decision 3).
//!
//! It is looked for on the host's PATH as it is now ([`host::path`]), so
//! one installed while the engine runs is found. On Windows it is looked
//! for in its vendor's own folder first, where Claude Code's installer
//! puts it on no PATH; a program is taken before a `.cmd` or a `.bat` in
//! any folder of the PATH, as npm puts beside one, which Node starts only
//! through a shell; a program in `WindowsApps` is never one; and a
//! `claude` that does not say it is Claude Code is passed over, as an old
//! Claude Desktop's alias (ADR 0090, decision 3). Claude Code's adapter
//! starts its CLI with no shell, so npm's `claude.cmd` is handed to it as
//! what the `.cmd` runs ([`handed`]).

use crate::model::CliView;
use crate::{Failed, Harness};
use banda_kernel::{Environment, Input, Program, host};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::timeout;

/// How long a CLI may take to say its version.
const ASKING: Duration = Duration::from_secs(5);

/// The version each CLI said, by its path, at the latest look: a fact of
/// this computer, whichever process looked. So a Person who updated it and
/// checked again sees every Thread on it stop warning.
static SAID: Mutex<BTreeMap<String, Option<String>>> = Mutex::new(BTreeMap::new());

/// Where a Harness's CLI was found, and the least version its entry asks
/// for: what tells, at each look, whether it is old.
pub struct Located {
    pub path: String,
    minimum: Option<String>,
}

impl Located {
    pub fn new(path: String, harness: &Harness) -> Self {
        let minimum = harness.cli.as_ref().and_then(|cli| cli.minimum.clone());
        Self { path, minimum }
    }

    /// Why it is old, for the Harness `name`, as the latest look found.
    pub fn outdated(&self, name: &str) -> Option<String> {
        let version = SAID.lock().unwrap().get(&self.path).cloned()??;
        warning(name, &self.path, &version, self.minimum.as_deref()?)
    }
}

/// What a Harness's CLI at `path` that says `version` warns, when it is
/// older than `minimum`.
fn warning(name: &str, path: &str, version: &str, minimum: &str) -> Option<String> {
    older(version, minimum).then(|| {
        let program = Path::new(path).file_name().unwrap_or_default();
        format!(
            "{} {version} is older than {minimum}, which Banda's {name} adapter was built \
             for. It still runs, but some things may not work until you update it.",
            program.display(),
        )
    })
}

/// Finds the CLI `harness` names, and the version it says in
/// `environment`. The entry it returns sets the adapter's variable to the
/// CLI's path. A CLI that is not installed stays so until the Person
/// installs it.
pub async fn find(
    environment: &dyn Environment,
    harness: &Harness,
) -> Result<(Harness, Option<CliView>), Failed> {
    let Some(cli) = &harness.cli else {
        return Ok((harness.clone(), None));
    };
    let not_installed = || {
        Failed::Lasting(format!(
            "{} runs `{}`, which is not installed on this computer: install it, then check again.",
            harness.name, cli.program
        ))
    };
    let mut found = None;
    let mut unstartable = None;
    for candidate in candidates(&cli.program) {
        let path = candidate.display().to_string();
        let Some(handed) = handed(&cli.program, &candidate) else {
            tracing::warn!(cli = %path, "its adapter cannot start this script, and it is passed over");
            unstartable.get_or_insert(path);
            continue;
        };
        let said = said_by(environment, &path, harness).await;
        if said
            .as_deref()
            .is_some_and(|said| !claims(&cli.program, said))
        {
            tracing::warn!(cli = %path, "this is not the CLI its name says, and is passed over");
            continue;
        }
        let handed = handed.display().to_string();
        found = Some((handed, said.as_deref().and_then(version_in)));
        break;
    }
    let (path, version) = match (found, unstartable) {
        (Some(found), _) => found,
        (None, Some(script)) => {
            return Err(Failed::Lasting(format!(
                "{} runs `{}`, which is on this computer only as {script}, a script its \
                 adapter cannot start on Windows: install its own build, then check again.",
                harness.name, cli.program
            )));
        }
        (None, None) => return Err(not_installed()),
    };
    SAID.lock().unwrap().insert(path.clone(), version.clone());
    let outdated = Located::new(path.clone(), harness).outdated(&harness.name);
    let mut started = harness.clone();
    started.env.insert(cli.variable.clone(), path.clone());
    let view = CliView {
        path,
        version,
        outdated,
    };
    Ok((started, Some(view)))
}

/// `program` itself when it is a path, or the first of that name on the
/// host's PATH; on Windows, its vendor's folder first.
pub(crate) fn located(program: &str) -> Option<PathBuf> {
    candidates(program).next()
}

/// Where `program` may be, in the order it is looked for: its vendor's
/// folder, then the host's PATH, a `.cmd` or a `.bat` last.
fn candidates(program: &str) -> impl Iterator<Item = PathBuf> + use<> {
    let on_path = scripts_last(host::programs(Path::new(program), &host::path()));
    vendors(program).into_iter().chain(on_path)
}

/// `found` in its order, but each `.cmd` and `.bat`, which runs through
/// `cmd.exe` on Windows, after every program.
fn scripts_last(found: impl Iterator<Item = PathBuf>) -> impl Iterator<Item = PathBuf> {
    let (scripts, programs): (Vec<_>, Vec<_>) = found.partition(|path| script(path));
    programs.into_iter().chain(scripts)
}

/// Whether `path` is a `.cmd` or a `.bat`, which runs through `cmd.exe`:
/// on Windows; elsewhere none is.
fn script(path: &Path) -> bool {
    let extension = path.extension().and_then(|extension| extension.to_str());
    cfg!(windows)
        && extension
            .is_some_and(|it| it.eq_ignore_ascii_case("cmd") || it.eq_ignore_ascii_case("bat"))
}

/// What the CLI `program`, found at `found`, is handed to its adapter as:
/// itself, but on Windows npm's `claude.cmd` as what it runs. Claude
/// Code's adapter starts its CLI with Node's spawn and no shell, which
/// starts no `.cmd` or `.bat` (Node's fix for CVE-2024-27980), and runs a
/// `.js` with node. None when what it runs is not found: the adapter
/// could not start it.
fn handed(program: &str, found: &Path) -> Option<PathBuf> {
    match program == "claude" && script(found) {
        true => npm_runs(found),
        false => Some(found.to_owned()),
    }
}

/// The program or the script npm's shim `shim` runs, from beside it: the
/// last `"%dp0%\…"` it names that is not Node, as
/// `node_modules\@anthropic-ai\claude-code\bin\claude.exe`, or an older
/// release's `cli.js`. None when it names none, or that is not there.
fn npm_runs(shim: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(shim).ok()?;
    let named = (text.split('"'))
        .filter_map(|quoted| {
            (quoted.strip_prefix("%dp0%\\")).or_else(|| quoted.strip_prefix("%~dp0\\"))
        })
        .rfind(|named| !named.eq_ignore_ascii_case("node.exe"))?;
    let runs =
        (named.split(['\\', '/'])).fold(shim.parent()?.to_owned(), |path, part| path.join(part));
    let extension = runs.extension().and_then(|extension| extension.to_str());
    let startable = extension.is_some_and(|it| {
        ["exe", "js", "mjs", "cjs"]
            .iter()
            .any(|known| it.eq_ignore_ascii_case(known))
    });
    (startable && runs.is_file()).then_some(runs)
}

/// Where a CLI's vendor installs it on Windows, by its name: Claude Code's
/// installer in `%USERPROFILE%\.local\bin`, which it puts on no PATH, and
/// Codex's in `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`. None elsewhere.
fn vendors(program: &str) -> Vec<PathBuf> {
    let folder = match program {
        _ if !cfg!(windows) => None,
        "claude" => dirs::home_dir().map(|home| home.join(".local").join("bin")),
        "codex" => dirs::data_local_dir().map(|local| {
            local
                .join("Programs")
                .join("OpenAI")
                .join("Codex")
                .join("bin")
        }),
        _ => None,
    };
    folder.map_or_else(Vec::new, |folder| {
        host::programs(Path::new(program), folder.as_os_str()).collect()
    })
}

/// Whether what the CLI `program` said of its version says it is that
/// CLI: on Windows a `claude` says "(Claude Code)", where an old Claude
/// Desktop's `Claude.exe` would be another program. Elsewhere any is.
fn claims(program: &str, said: &str) -> bool {
    !cfg!(windows) || program != "claude" || said.contains("(Claude Code)")
}

/// What the CLI at `path` says to `--version`, in `environment`; none when
/// it did not start, or said nothing within [`ASKING`]: then it cannot
/// tell, which is not "not installed" (ADR 0059, decision 3).
async fn said_by(environment: &dyn Environment, path: &str, harness: &Harness) -> Option<String> {
    let mut asking = Program::harness_probe(path, vec!["--version".to_owned()]);
    asking.env = harness.env.clone();
    let asked = environment.spawn(&asking, Input::Null).ok()?;
    let said = timeout(ASKING, asked.wait_with_output()).await.ok()?.ok()?;
    Some(String::from_utf8_lossy(&said.stdout).into_owned())
}

/// The first word of `said` that reads as a version: `2.1.316` in
/// "2.1.316 (Claude Code)", `0.166.0` in "codex-cli 0.166.0".
fn version_in(said: &str) -> Option<String> {
    said.split_whitespace()
        .map(|word| word.trim_start_matches('v'))
        .find(|word| {
            word.starts_with(|c: char| c.is_ascii_digit())
                && word.contains('.')
                && word
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))
        })
        .map(str::to_owned)
}

/// Whether `version` comes before `minimum`, number by number: 2.1.99
/// before 2.1.312, 2.1 the same as 2.1.0. A leading `v` and what follows
/// `-` or `+`, as in `0.165.0-alpha.3`, are not compared.
fn older(version: &str, minimum: &str) -> bool {
    let numbers = |version: &str| -> Vec<u64> {
        let version = version.trim_start_matches('v');
        let release = version.split(['-', '+']).next().unwrap_or_default();
        release
            .split('.')
            .map(|part| {
                let digits = part
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(part.len());
                part[..digits].parse().unwrap_or(0)
            })
            .collect()
    };
    let (version, minimum) = (numbers(version), numbers(minimum));
    let at = |numbers: &[u64], i: usize| numbers.get(i).copied().unwrap_or(0);
    (0..version.len().max(minimum.len()))
        .map(|i| at(&version, i).cmp(&at(&minimum, i)))
        .find(|order| order.is_ne())
        .is_some_and(std::cmp::Ordering::is_lt)
}

#[cfg(test)]
mod tests {
    use super::{claims, older, version_in};

    /// A CLI as npm installs one on Windows, a `.cmd`, found by its name
    /// and asked its version through the environment a Harness's starts
    /// in, as `banda call` asks it.
    #[cfg(windows)]
    #[tokio::test]
    async fn on_windows_a_cli_that_is_a_cmd_is_found_and_says_its_version() {
        use banda_kernel::host;
        let folder = tempfile::tempdir().unwrap();
        let apps = folder.path().join("WindowsApps");
        std::fs::create_dir(&apps).unwrap();
        // A Store alias first on PATH, which is never run.
        std::fs::write(apps.join("claude.exe"), "").unwrap();
        let cmd = "@echo off\r\necho 2.1.316 (Claude Code)\r\n";
        std::fs::write(folder.path().join("claude.cmd"), cmd).unwrap();
        let path = std::env::join_paths([apps.as_path(), folder.path()]).unwrap();
        let found = host::find("claude", &path).unwrap();
        assert_eq!(found, folder.path().join("claude.cmd"));
        let harness = crate::Harnesses::known().find("claude").unwrap();
        let path = found.display().to_string();
        let said = super::said_by(&banda_environments::Local, &path, &harness).await;
        let said = said.expect("it said its version");
        assert!(claims("claude", &said), "{said}");
        assert_eq!(version_in(&said).as_deref(), Some("2.1.316"));
    }

    /// npm's `claude.cmd` on the PATH before the folder of a `claude.exe`.
    #[cfg(windows)]
    #[test]
    fn on_windows_a_program_is_taken_before_a_cmd_on_any_folder_of_the_path() {
        use banda_kernel::host;
        let (npm, own) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(npm.path().join("claude.cmd"), "").unwrap();
        std::fs::write(own.path().join("claude.exe"), "").unwrap();
        let path = std::env::join_paths([npm.path(), own.path()]).unwrap();
        let found = host::programs(std::path::Path::new("claude"), &path);
        let found: Vec<_> = super::scripts_last(found).collect();
        let first = [own.path().join("claude.exe"), npm.path().join("claude.cmd")];
        assert_eq!(found, first);
    }

    /// npm's shims, as `npm install -g` writes them on Windows: for a
    /// program, and for a script Node runs.
    const NPM_EXE: &str = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n\
        :start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\
        \"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"   %*\r\n";
    const NPM_JS: &str = "@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\n\
        IF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n\
        \x20 SET \"_prog=node\"\r\n)\r\n\
        endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \
        \"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js\" %*\r\n";

    #[test]
    fn npm_s_shim_is_read_for_the_program_or_script_it_runs() {
        use super::npm_runs;
        let folder = tempfile::tempdir().unwrap();
        let package = folder.path().join("node_modules/@anthropic-ai/claude-code");
        std::fs::create_dir_all(package.join("bin")).unwrap();
        let shim = folder.path().join("claude.cmd");
        std::fs::write(&shim, NPM_EXE).unwrap();
        assert_eq!(npm_runs(&shim), None, "its program is not there");
        let program = package.join("bin").join("claude.exe");
        std::fs::write(&program, "").unwrap();
        let runs = npm_runs(&shim).unwrap();
        assert!(runs.ends_with("node_modules/@anthropic-ai/claude-code/bin/claude.exe"));
        std::fs::write(package.join("cli.js"), "").unwrap();
        std::fs::write(&shim, NPM_JS).unwrap();
        let runs = npm_runs(&shim).unwrap();
        assert!(runs.ends_with("node_modules/@anthropic-ai/claude-code/cli.js"));
        std::fs::write(&shim, "@echo off\r\nnode \"%~dp0\\..\\x\" %*\r\n").unwrap();
        assert_eq!(npm_runs(&shim), None, "what it names is not there");
    }

    /// On Windows, Claude Code's adapter is never handed a `.cmd`, which
    /// Node starts only through a shell: npm's is handed as what it runs.
    #[test]
    fn claude_s_adapter_is_handed_no_cmd_on_windows() {
        use super::handed;
        let folder = tempfile::tempdir().unwrap();
        let shim = folder.path().join("claude.cmd");
        std::fs::write(&shim, NPM_EXE).unwrap();
        let program = folder
            .path()
            .join("node_modules/@anthropic-ai/claude-code/bin/claude.exe");
        let unstartable = if cfg!(windows) {
            None
        } else {
            Some(shim.clone())
        };
        assert_eq!(
            handed("claude", &shim),
            unstartable,
            "what it runs is not there"
        );
        std::fs::create_dir_all(program.parent().unwrap()).unwrap();
        std::fs::write(&program, "").unwrap();
        let handed_as = handed("claude", &shim).unwrap();
        assert_eq!(handed_as.ends_with("claude.exe"), cfg!(windows));
        let codex = folder.path().join("codex.cmd");
        assert_eq!(handed("codex", &codex), Some(codex.clone()));
    }

    #[test]
    fn on_windows_only_a_claude_that_says_it_is_claude_code_is_one() {
        assert!(claims("claude", "2.1.316 (Claude Code)\n"));
        assert_eq!(claims("claude", "Claude 1.0.0\n"), !cfg!(windows));
        assert!(claims("codex", "codex-cli 0.166.0"));
    }

    #[test]
    fn a_version_is_older_number_by_number() {
        assert!(older("2.1.99", "2.1.312"));
        assert!(older("0.164.9", "0.165.0"));
        assert!(!older("2.1", "2.1.0"));
        assert!(older("2.1", "2.1.1"));
        assert!(!older("2.1.312", "2.1.312"));
        assert!(!older("0.165.0-alpha.3", "0.165.0"));
        assert!(older("2.1.311", "v2.1.312"));
        assert!(!older("2.1.316", "2.1.312"));
        assert!(!older("0.166.0", "0.165.0"));
        assert!(!older("3.0.0-beta", "2.9.9"));
    }

    #[test]
    fn a_version_is_the_first_word_that_reads_as_one() {
        assert_eq!(
            version_in("2.1.316 (Claude Code)\n").as_deref(),
            Some("2.1.316")
        );
        assert_eq!(version_in("codex-cli 0.166.0").as_deref(), Some("0.166.0"));
        assert_eq!(version_in("tool v1.2").as_deref(), Some("1.2"));
        assert_eq!(version_in("no version here"), None);
    }
}
