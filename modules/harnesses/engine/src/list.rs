//! The Harness list is a text file of the machine (ADR 0002, decision 1):
//! `harnesses.toml` says which agent programs this computer can start, and
//! how. What a Thread on one starts with is the agents module's own, in
//! `agents.toml` (ADR 0040, decision 6).

use crate::model::{HarnessView, LimitsLook, Program};
use banda_kernel::{ProjectId, project_env};
use banda_look::Problem;
use schemars::JsonSchema;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The variable that names the folder of a Project's Claude Code sessions
/// to the adapter Banda carries (ADR 0078, decision 3).
pub const SESSIONS_VARIABLE: &str = "BANDA_CLAUDE_SESSIONS";

/// An agent program and how to start it. It speaks ACP on its stdio.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Harness {
    /// How Banda names it: `claude`, `codex`.
    pub id: String,
    /// What the Person reads: `Claude Code`.
    pub name: String,
    /// What a sentence calls it, when shorter than its name: `Claude`.
    pub short: Option<String>,
    /// The program that speaks ACP: its name on PATH, or its path.
    pub command: String,
    /// Whether it is on: one turned off starts nothing new.
    pub enabled: bool,
    /// The program's arguments.
    pub args: Vec<String>,
    /// Variables over the environment it starts in.
    pub env: BTreeMap<String, String>,
    /// The Person's own CLI the program runs, when it runs one.
    pub cli: Option<Cli>,
    /// The file of the adapter Banda carries, which starts in place of
    /// `command` and `args` when the window said where its adapters are
    /// (ADR 0059): only Banda's own entries have one.
    pub carried: Option<String>,
    /// A folder where each start of the program writes what Banda and
    /// the Harness say to each other, one ACP frame per line, for tests to
    /// replay. Only a test sets it, never a Harness list: a recording holds
    /// everything said, a secret typed into a form too.
    pub record: Option<PathBuf>,
}

/// A CLI the Person installed, which an adapter runs in place of a copy
/// of its own (ADR 0003, decision 3).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, JsonSchema)]
pub struct Cli {
    /// Its name on PATH, or its path.
    pub program: String,
    /// The variable that tells the adapter where it is: Claude Code's
    /// `CLAUDE_CODE_EXECUTABLE`, Codex's `CODEX_PATH`.
    pub variable: String,
    /// The oldest version the adapter supports: the one it was built for.
    /// An older CLI still runs, with a warning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<String>,
}

impl Harness {
    /// The entry's own program with `args` after its arguments and `env`
    /// over its environment, as a Harness's sign-in in a terminal runs.
    pub fn program(&self, args: &[String], env: &HashMap<String, String>) -> Program {
        let start = self.start();
        Program {
            program: start.program,
            args: start.args.into_iter().chain(args.iter().cloned()).collect(),
            env: start.env.into_iter().chain(env.clone()).collect(),
        }
    }

    /// How its process starts: the adapter Banda carries, on the window's
    /// Electron as Node, when it has one and the window said where (ADR
    /// 0059); else its `command` and `args`.
    pub fn start(&self) -> Program {
        self.start_with(carried())
    }

    fn start_with(&self, carried: Option<&Carried>) -> Program {
        let mut env = self.env.clone();
        let (program, args) = match (&self.carried, carried) {
            (Some(file), Some(Carried { node, adapters })) => {
                env.insert("ELECTRON_RUN_AS_NODE".to_owned(), "1".to_owned());
                let file = adapters.join(file).display().to_string();
                (node.display().to_string(), vec![file])
            }
            _ => (self.command.clone(), self.args.clone()),
        };
        Program { program, args, env }
    }

    /// The entry as its process for `project` starts: it, and every program
    /// it starts, an Agent's server too, carries the Project (ADR 0044,
    /// decision 2). Its process for the machine carries none.
    ///
    /// Claude Code's sessions go in the Project's `data`, one folder for
    /// every Claude account, so any of them goes on with a Thread's session
    /// (ADR 0078, decision 3). The adapter Banda carries reads the folder
    /// from `BANDA_CLAUDE_SESSIONS`; another program ignores it.
    pub fn in_project(&self, project: ProjectId, data: &Path) -> Harness {
        let mut harness = self.clone();
        (harness.env).extend(project_env(project).map(|(key, id)| (key.to_owned(), id)));
        if crate::limits::Kind::of(self) == Some(crate::limits::Kind::Claude) {
            let sessions = data.join("sessions").join("claude");
            (harness.env).insert(SESSIONS_VARIABLE.to_owned(), sessions.display().to_string());
        }
        harness
    }
}

/// The Harnesses this machine can start. Read from a file, they follow
/// it: each look at them reads it again once it changed (ADR 0016), so a
/// Harness the settings Pane or the Person's editor changed starts its
/// next process as the file now says.
#[derive(Clone, Debug, Default)]
pub struct Harnesses(Arc<Mutex<List>>);

#[derive(Debug, Default)]
struct List {
    harnesses: Arc<[Harness]>,
    limits: LimitsSettings,
    usage: UsageSettings,
    /// The file the list follows, and its text when last read: none when
    /// it was not there. The text, not its time and size, tells a change,
    /// as the look's files do: two quick saves of one length share both.
    file: Option<(PathBuf, Option<String>)>,
}

/// `harnesses.toml` as the settings know it (ADR 0016): its schema, the
/// text it starts as, and its check.
pub const FILE: banda_look::SettingsFile =
    banda_look::SettingsFile::new::<HarnessFile>("harnesses.toml", template, check);

/// The Harnesses this machine can start, in this order.
/// Without the file, Banda starts Claude Code and Codex, each with the
/// Person's own CLI.
#[derive(Deserialize, JsonSchema)]
struct HarnessFile {
    /// One `[[harness]]` table per agent program.
    #[serde(default)]
    #[schemars(with = "Vec<HarnessEntry>")]
    harness: Vec<toml::Spanned<HarnessEntry>>,
    /// How Banda reads the usage limits of each Harness's account (ADR
    /// 0043).
    #[serde(default)]
    limits: LimitsEntry,
    /// Whether local session journals are counted (ADR 0043).
    #[serde(default)]
    usage: UsageSettings,
}

/// Local journal collection. Turning it off preserves saved totals but reads no files.
#[derive(Clone, Copy, Debug, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields)]
pub struct UsageSettings {
    /// Read Claude Code and Codex session journals on this computer.
    #[schemars(extend("default" = true))]
    pub read: bool,
}

impl Default for UsageSettings {
    fn default() -> Self {
        Self { read: true }
    }
}

/// The `[limits]` table. Every key is optional.
#[derive(Default, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct LimitsEntry {
    /// Whether Banda reads them: off, it reads no Harness's sign-in and
    /// asks for no limits.
    #[schemars(extend("default" = true))]
    read: Option<bool>,
    /// How often it reads them while a window is open, such as `"15m"` or
    /// `"1h"`: 5 minutes or more.
    #[schemars(extend("default" = "15m"))]
    #[schemars(with = "Option<String>")]
    every: Option<toml::Spanned<String>>,
    /// The share spent, out of 100, from which the bar's widget warns.
    #[schemars(extend("default" = 80), range(min = 1, max = 100))]
    warn: Option<u8>,
    /// How the bar's widget shows the room left.
    #[schemars(extend("default" = "icon"))]
    #[schemars(with = "Option<LimitsLook>")]
    look: Option<toml::Spanned<String>>,
}

/// How Banda reads the limits, every key of `[limits]` resolved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LimitsSettings {
    pub read: bool,
    pub every: Duration,
    pub warn: u8,
    pub look: LimitsLook,
}

impl Default for LimitsSettings {
    fn default() -> Self {
        Self {
            read: true,
            every: Duration::from_secs(15 * 60),
            warn: 80,
            look: LimitsLook::default(),
        }
    }
}

/// The least `every`: Anthropic answers a closer read with 429.
const LEAST_EVERY: Duration = Duration::from_secs(5 * 60);

/// A time such as `"15m"`: a whole number of seconds, minutes or hours.
fn every(text: &str) -> Option<Duration> {
    let text = text.trim();
    let (number, unit) = text.split_at(text.find(|c: char| !c.is_ascii_digit())?);
    let seconds = match unit.trim() {
        "s" => 1,
        "m" => 60,
        "h" => 60 * 60,
        _ => return None,
    };
    let every = Duration::from_secs(number.parse::<u64>().ok()?.checked_mul(seconds)?);
    (every >= LEAST_EVERY).then_some(every)
}

impl LimitsEntry {
    fn limits(self, path: &Path, text: &str) -> Result<LimitsSettings, Problem> {
        let base = LimitsSettings::default();
        let every = match self.every {
            None => base.every,
            Some(said) => every(said.get_ref()).ok_or_else(|| {
                let message = "`every` is a time such as \"15m\" or \"1h\", of 5 minutes or more";
                Problem::at(path, text, Some(said.span()), message.to_owned())
            })?,
        };
        let look = match self.look {
            None => base.look,
            Some(said) => LimitsLook::named(said.get_ref()).ok_or_else(|| {
                let message = "`look` is \"icon\", \"meter\", \"number\" or \"providers\"";
                Problem::at(path, text, Some(said.span()), message.to_owned())
            })?,
        };
        Ok(LimitsSettings {
            read: self.read.unwrap_or(base.read),
            every,
            warn: self.warn.unwrap_or(base.warn).clamp(1, 100),
            look,
        })
    }
}

/// One `[[harness]]` table. An entry with the ID of a Harness Banda
/// knows, `claude` or `codex`, takes each key it leaves out from Banda:
/// so a Banda that moves an adapter to a newer version moves this
/// machine's too. Any other ID needs a `name` and a `command`.
#[derive(Deserialize, JsonSchema)]
struct HarnessEntry {
    /// How Banda names it: `claude`, `codex`.
    id: String,
    /// What the Person reads: `Claude Code`.
    name: Option<String>,
    /// What a sentence calls it, when shorter than its name: `Claude`.
    short: Option<String>,
    /// The program that speaks ACP: its name on PATH, or its path.
    command: Option<String>,
    /// Whether it is on. One turned off stays in the list, with how it
    /// starts, for when it is turned on again.
    #[schemars(extend("default" = true))]
    enabled: Option<bool>,
    /// The program's arguments.
    args: Option<Vec<String>>,
    /// Variables over the environment it starts in.
    env: Option<BTreeMap<String, String>>,
    /// The Person's own CLI the program runs, when it runs one.
    cli: Option<Cli>,
}

impl HarnessEntry {
    /// The entry over Banda's own Harness of its ID, if Banda has one.
    /// Banda's arguments and CLI go with Banda's command: an entry that
    /// names another command says its own.
    fn harness(mut self) -> Result<Harness, String> {
        let (command, args) = (self.command.as_deref(), self.args.as_deref());
        if ADAPTERS
            .iter()
            .any(|a| a.id == self.id && a.was(command, args))
        {
            (self.command, self.args) = (None, None);
        }
        let mut base = known().into_iter().find(|known| known.id == self.id);
        if let (Some(base), Some(command)) = (&mut base, &self.command)
            && *command != base.command
        {
            base.args.clear();
            base.cli = None;
            base.carried = None;
        }
        // The carried adapter starts only for Banda's own start: an entry
        // that names its own arguments runs them.
        if let Some(base) = &mut base
            && self.args.as_ref().is_some_and(|args| *args != base.args)
        {
            base.carried = None;
        }
        // Banda's short name goes with Banda's name.
        let short = match &self.name {
            None => self.short.or_else(|| base.as_ref()?.short.clone()),
            Some(_) => self.short,
        };
        let name = self.name.or_else(|| base.as_ref().map(|b| b.name.clone()));
        let command = self
            .command
            .or_else(|| base.as_ref().map(|b| b.command.clone()));
        let (Some(name), Some(command)) = (name, command) else {
            return Err(format!(
                "Banda does not know a Harness {:?}: its entry needs a name and a command",
                self.id
            ));
        };
        let base = base.map(|b| (b.args, b.env, b.cli, b.carried));
        let (args, env, cli, carried) = base.unwrap_or_default();
        Ok(Harness {
            id: self.id,
            name,
            short,
            command,
            enabled: self.enabled.unwrap_or(true),
            args: self.args.unwrap_or(args),
            env: self.env.unwrap_or(env),
            cli: self.cli.or(cli),
            carried,
            record: None,
        })
    }
}

impl Harnesses {
    pub fn new(harnesses: Vec<Harness>) -> Self {
        let limits = LimitsSettings::default();
        Self::with(
            Read {
                harnesses,
                limits,
                usage: UsageSettings::default(),
            },
            None,
        )
    }

    fn with(read: Read, file: Option<(PathBuf, Option<String>)>) -> Self {
        let Read {
            harnesses,
            limits,
            usage,
        } = read;
        let harnesses = harnesses.into();
        Self(Arc::new(Mutex::new(List {
            harnesses,
            limits,
            usage,
            file,
        })))
    }

    /// The Harnesses Banda starts when a machine names none: the ACP
    /// adapters for Claude Code and Codex, at versions we checked, each
    /// running the Person's own CLI. Each one signs in on its own; Banda
    /// holds no model provider's credentials.
    pub fn known() -> Self {
        Self::new(known())
    }

    /// The machine's Harness list in `path`, followed from then on. A
    /// machine with no list gets the [`known`](Self::known) Harnesses.
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = read(path)?;
        let read = listed(path, text.as_deref())?;
        Ok(Self::with(read, Some((path.to_owned(), text))))
    }

    /// The list as its file says now. A file that changed into one that
    /// does not read is logged, and the list before it stays.
    fn now(&self) -> Arc<[Harness]> {
        self.followed().0
    }

    /// The list and `[limits]` as the file says now, in one read.
    pub(crate) fn followed(&self) -> (Arc<[Harness]>, LimitsSettings) {
        let mut list = self.0.lock().unwrap();
        let List {
            harnesses,
            limits,
            usage,
            file,
        } = &mut *list;
        if let Some((path, was)) = file {
            match read(path) {
                Ok(text) if text != *was => {
                    match listed(path, text.as_deref()) {
                        Ok(read) => {
                            (*harnesses, *limits, *usage) =
                                (read.harnesses.into(), read.limits, read.usage)
                        }
                        Err(error) => tracing::warn!(%error, "the Harness list does not read"),
                    }
                    *was = text;
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "the Harness list cannot be read"),
            }
        }
        (harnesses.clone(), *limits)
    }

    pub(crate) fn usage(&self) -> (Arc<[Harness]>, UsageSettings) {
        let (harnesses, _) = self.followed();
        (harnesses, self.0.lock().unwrap().usage)
    }

    pub fn find(&self, id: &str) -> Option<Harness> {
        self.now().iter().find(|h| h.id == id).cloned()
    }

    /// Entry `id`, when it is on.
    pub fn get(&self, id: &str) -> Result<Harness, String> {
        match self.find(id) {
            Some(harness) if harness.enabled => Ok(harness),
            Some(harness) => Err(format!("{} is turned off in harnesses.toml.", harness.name)),
            None => Err(format!("This computer has no Harness named \"{id}\".")),
        }
    }

    pub fn views(&self) -> Vec<HarnessView> {
        self.now().iter().map(HarnessView::of).collect()
    }
}

/// An ACP adapter Banda carries (ADR 0059): the Harness it is, its npm
/// package and version (`modules/harnesses/desktop/package.json` pins the
/// same), and the Person's CLI it runs.
struct Adapter {
    id: &'static str,
    name: &'static str,
    short: &'static str,
    package: &'static str,
    version: &'static str,
    cli: (&'static str, &'static str, &'static str),
}

const ADAPTERS: [Adapter; 2] = [
    Adapter {
        id: "claude",
        name: "Claude Code",
        short: "Claude",
        package: "@agentclientprotocol/claude-agent-acp",
        version: "0.99.1",
        // The adapter's Agent SDK 0.3.312 was built for Claude Code
        // 2.1.312 (its `claudeCodeVersion`).
        cli: ("claude", "CLAUDE_CODE_EXECUTABLE", "2.1.312"),
    },
    Adapter {
        id: "codex",
        name: "Codex",
        short: "Codex",
        package: "@agentclientprotocol/codex-acp",
        version: "2.5.0",
        // The adapter depends on `@openai/codex` ^0.165.0.
        cli: ("codex", "CODEX_PATH", "0.165.0"),
    },
];

/// Where the window says the adapters it carries are, and the Node that
/// runs them: its own Electron (ADR 0059, decision 1). An engine started
/// without the window, as a test's, has neither.
struct Carried {
    node: PathBuf,
    adapters: PathBuf,
}

fn carried() -> Option<&'static Carried> {
    static CARRIED: std::sync::OnceLock<Option<Carried>> = std::sync::OnceLock::new();
    CARRIED
        .get_or_init(|| {
            Some(Carried {
                node: std::env::var_os("BANDA_NODE")?.into(),
                adapters: std::env::var_os("BANDA_ADAPTERS")?.into(),
            })
        })
        .as_ref()
}

/// Each adapter as Banda starts it: from npm, as `npx` downloads it,
/// without the vendors' CLIs it never runs; or the copy the app carries,
/// when the window says where (`Harness::start`).
fn known() -> Vec<Harness> {
    ADAPTERS
        .iter()
        .map(|adapter| {
            let (program, variable, minimum) = adapter.cli;
            Harness {
                id: adapter.id.to_owned(),
                name: adapter.name.to_owned(),
                short: Some(adapter.short.to_owned()),
                command: "npx".to_owned(),
                args: vec!["-y".to_owned(), adapter.npm()],
                enabled: true,
                env: BTreeMap::from([("npm_config_omit".to_owned(), "optional".to_owned())]),
                cli: Some(Cli {
                    program: program.to_owned(),
                    variable: variable.to_owned(),
                    minimum: Some(minimum.to_owned()),
                }),
                carried: Some(adapter.file()),
                record: None,
            }
        })
        .collect()
}

impl Adapter {
    /// What `npx` names it by.
    fn npm(&self) -> String {
        format!("{}@{}", self.package, self.version)
    }

    /// The file the app carries it as: its package's name, bundled
    /// (`modules/harnesses/desktop/adapters.mjs`).
    fn file(&self) -> String {
        let name = self.package.rsplit('/').next().unwrap_or(self.package);
        format!("{name}.mjs")
    }

    /// Whether `command` and `args` are how Banda started this adapter
    /// before it carried it, `npx -y <package>@<any version>`: a file that
    /// wrote that down moves to the carried one (ADR 0059, decision 9).
    fn was(&self, command: Option<&str>, args: Option<&[String]>) -> bool {
        let at = format!("{}@", self.package);
        matches!(
            (command, args),
            (Some("npx"), Some([yes, package])) if yes == "-y" && package.starts_with(&at)
        )
    }
}

/// What a `harnesses.toml` says.
struct Read {
    harnesses: Vec<Harness>,
    limits: LimitsSettings,
    usage: UsageSettings,
}

fn parse(path: &Path, text: &str) -> Result<Read, Problem> {
    let file = toml::from_str::<HarnessFile>(text).map_err(|e| Problem::toml(path, text, &e))?;
    let harnesses = (file.harness.into_iter())
        .map(|entry| {
            let span = entry.span();
            let wrong = |message| Problem::at(path, text, Some(span), message);
            entry.into_inner().harness().map_err(wrong)
        })
        .collect::<Result<_, _>>()?;
    let limits = file.limits.limits(path, text)?;
    Ok(Read {
        harnesses,
        limits,
        usage: file.usage,
    })
}

/// The file's text; none when it is not there.
fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

/// What `text` says, or the known list when there is no file.
fn listed(path: &Path, text: Option<&str>) -> Result<Read, String> {
    match text {
        Some(text) => parse(path, text).map_err(|problem| problem.to_string()),
        None => Ok(Read {
            harnesses: known(),
            limits: LimitsSettings::default(),
            usage: UsageSettings::default(),
        }),
    }
}

/// What is wrong in `text`, a `harnesses.toml` at `path`: what does not
/// read, and an entry's `start` from before ADR 0040, which no one reads
/// here now. That one is a hint for a file from then, to go once such
/// files are gone, not a word of the agents module's.
fn check(path: &Path, text: &str) -> Vec<Problem> {
    if let Err(problem) = parse(path, text) {
        return vec![problem];
    }
    #[derive(Deserialize)]
    struct Old {
        #[serde(default)]
        harness: Vec<OldEntry>,
    }
    #[derive(Deserialize)]
    struct OldEntry {
        id: String,
        start: Option<toml::Spanned<toml::Value>>,
    }
    let old = toml::from_str::<Old>(text)
        .map(|old| old.harness)
        .unwrap_or_default();
    old.into_iter()
        .filter_map(|entry| Some((entry.id, entry.start?.span())))
        .map(|(id, span)| {
            let moved = format!(
                "What a new Thread starts with is agents.toml's now: move this to its [start.{id}]"
            );
            Problem::at(path, text, Some(span), moved)
        })
        .collect()
}

/// What `harnesses.toml` starts as when the settings Pane first writes
/// it: the known Harnesses by their IDs alone, so a change to one keeps
/// the others, and each takes how it starts from Banda.
fn template() -> String {
    let ids: String = known()
        .iter()
        .map(|harness| format!("\n[[harness]]\nid = {:?}\n", harness.id))
        .collect();
    format!(
        "#:schema ./schemas/harnesses.schema.json\n\
         # The Harnesses Banda can start, in this order. Without\n\
         # this file, the ones below. An entry with the ID of one Banda knows\n\
         # takes each key it leaves out from Banda, the adapter's version too;\n\
         # any other ID needs a name and a command. Check a change with:\n\
         # banda settings check\n\n[usage]\nread = true\n{ids}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listed_in(path: &Path, text: &str) -> Result<Vec<Harness>, Problem> {
        parse(path, text).map(|read| read.harnesses)
    }

    #[test]
    fn limits_read_from_their_table() {
        let path = Path::new("h");
        let read = |text: &str| parse(path, text).map(|read| read.limits);
        assert_eq!(read("").unwrap(), LimitsSettings::default());
        let set = read("[limits]\nread = false\nevery = \"1h\"\nwarn = 90\nlook = \"meter\"\n");
        assert_eq!(
            set.unwrap(),
            LimitsSettings {
                read: false,
                every: Duration::from_secs(3600),
                warn: 90,
                look: LimitsLook::Meter,
            }
        );
        let problem = read("[limits]\nwarn = 90\nlook = \"ring\"\n").unwrap_err();
        assert_eq!(problem.line, Some(3), "{problem}");
        assert!(problem.message.contains("`look`"), "{problem}");
        for wrong in ["\"1m\"", "\"15\"", "\"m\"", "\"15 days\""] {
            let problem = read(&format!("[limits]\nevery = {wrong}\n")).unwrap_err();
            assert_eq!(problem.line, Some(2), "{wrong}: {problem}");
        }
        assert!(read("[limits]\nnever = 1\n").is_err(), "an unknown key");
    }

    #[test]
    fn a_harness_list_reads_from_text() {
        let list = listed_in(
            Path::new("harnesses.toml"),
            r#"
            [[harness]]
            id = "fake"
            name = "Fake"
            command = "/bin/fake"
            args = ["--quiet"]
            "#,
        )
        .map(Harnesses::new)
        .unwrap();
        let fake = list.find("fake").unwrap();
        assert_eq!(fake.args, ["--quiet"]);
        assert!(list.find("claude").is_none());
        assert!(listed_in(Path::new("h"), "harness = 3").is_err());
    }

    #[test]
    fn the_list_follows_its_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("harnesses.toml");
        let list = Harnesses::load(&path).unwrap();
        assert!(list.find("claude").is_some(), "no file: the known ones");
        let fake = "[[harness]]\nid = \"fake\"\nname = \"Fake\"\ncommand = \"fake\"\n";
        std::fs::write(&path, fake).unwrap();
        assert!(list.find("claude").is_none());
        assert_eq!(list.get("fake").unwrap().command, "fake");
        std::fs::write(&path, format!("{fake}enabled = false\n")).unwrap();
        assert_eq!(
            list.get("fake").unwrap_err(),
            "Fake is turned off in harnesses.toml."
        );
        assert!(!list.views()[0].enabled, "a list shows it still");
        std::fs::write(&path, "harness = 3").unwrap();
        assert!(
            list.find("fake").is_some(),
            "a file that does not read changes nothing"
        );
    }

    #[test]
    fn the_template_reads_as_the_known_harnesses() {
        assert_eq!(listed_in(Path::new("h"), &template()).unwrap(), known());
        assert!(
            !template().contains("@agentclientprotocol"),
            "no version is written down"
        );
    }

    #[test]
    fn a_known_id_takes_what_its_entry_leaves_out_from_banda() {
        let list = listed_in(
            Path::new("h"),
            "[[harness]]\nid = \"codex\"\nenabled = false\n",
        )
        .unwrap();
        let codex = known().into_iter().find(|h| h.id == "codex").unwrap();
        assert_eq!(
            list,
            vec![Harness {
                enabled: false,
                ..codex
            }]
        );
        assert!(
            list.iter().all(|h| h.id != "claude"),
            "the file is the list"
        );

        let own = listed_in(
            Path::new("h"),
            "[[harness]]\nid = \"claude\"\ncommand = \"my-acp\"\n",
        )
        .unwrap();
        assert_eq!(own[0].name, "Claude Code");
        assert_eq!(own[0].short.as_deref(), Some("Claude"));
        // A name of the entry's own takes its own short name, or none.
        let named = "[[harness]]\nid = \"claude\"\nname = \"Work\"\n\
                     [[harness]]\nid = \"codex\"\nname = \"Team Codex\"\nshort = \"Team\"\n";
        let named = listed_in(Path::new("h"), named).unwrap();
        let shorts: Vec<_> = named.iter().map(|h| h.short.as_deref()).collect();
        assert_eq!(shorts, [None, Some("Team")]);
        assert_eq!(
            (own[0].args.len(), own[0].cli.is_none()),
            (0, true),
            "Banda's arguments go with Banda's command"
        );
        let flag = "[[harness]]\nid = \"claude\"\ncommand = \"npx\"\nargs = [\"x\"]\n";
        let flag = listed_in(Path::new("h"), flag).unwrap();
        assert!(
            flag[0].cli.is_some(),
            "Banda's command still runs the Person's CLI"
        );
    }

    #[test]
    fn a_carried_adapter_runs_on_the_windows_electron() {
        let carried = Carried {
            node: "/app/banda".into(),
            adapters: "/app/resources/adapters".into(),
        };
        let claude = known().remove(0);
        let start = claude.start_with(Some(&carried));
        assert_eq!(start.program, "/app/banda");
        assert_eq!(start.args, ["/app/resources/adapters/claude-agent-acp.mjs"]);
        assert_eq!(start.env["ELECTRON_RUN_AS_NODE"], "1");
        let npx = claude.start_with(None);
        assert_eq!(
            (npx.program.as_str(), npx.args.as_slice()),
            ("npx", ["-y".to_owned(), ADAPTERS[0].npm()].as_slice())
        );
        assert_eq!(npx.env["npm_config_omit"], "optional", "no vendor's CLI");
    }

    #[test]
    fn a_file_with_the_old_npx_start_moves_to_banda_s() {
        let old = "[[harness]]\nid = \"claude\"\ncommand = \"npx\"\n\
                   args = [\"-y\", \"@agentclientprotocol/claude-agent-acp@0.31.0\"]\n";
        let claude = known().remove(0);
        assert_eq!(listed_in(Path::new("h"), old).unwrap(), vec![claude]);
        let pinned = "[[harness]]\nid = \"claude\"\ncommand = \"npx\"\n\
                      args = [\"-y\", \"my-fork@1\"]\n";
        let pinned = listed_in(Path::new("h"), pinned).unwrap().remove(0);
        assert_eq!(pinned.args, ["-y", "my-fork@1"]);
        assert_eq!(pinned.carried, None, "its own arguments run");
        let own = "[[harness]]\nid = \"claude\"\ncommand = \"my-acp\"\n";
        assert_eq!(listed_in(Path::new("h"), own).unwrap()[0].carried, None);
    }

    #[test]
    fn the_carried_versions_are_the_desktop_packages() {
        let package = include_str!("../../desktop/package.json");
        for adapter in &ADAPTERS {
            let pin = format!("\"{}\": \"{}\"", adapter.package, adapter.version);
            assert!(
                package.contains(&pin),
                "{pin} in harnesses' desktop package"
            );
        }
    }

    #[test]
    fn an_entrys_start_from_before_is_named() {
        let text = "[[harness]]\nid = \"claude\"\n\n[harness.start]\nmode = \"auto\"\n";
        let problems = check(Path::new("h"), text);
        assert_eq!(problems.len(), 1);
        assert!(
            problems[0].message.contains("[start.claude]"),
            "{}",
            problems[0]
        );
        assert!(check(Path::new("h"), &template()).is_empty());
    }

    #[test]
    fn claude_s_sessions_go_in_the_project_s_folder() {
        let project = ProjectId::new();
        let data = Path::new("/state/projects/p");
        let list = known();
        let claude = list[0].in_project(project, data);
        assert_eq!(
            claude.env[SESSIONS_VARIABLE],
            "/state/projects/p/sessions/claude"
        );
        let codex = list[1].in_project(project, data);
        assert!(
            !codex.env.contains_key(SESSIONS_VARIABLE),
            "Codex keeps its own"
        );
        let second = "[[harness]]\nid = \"work\"\nname = \"Work\"\ncommand = \"acp\"\n\
                      cli = { program = \"claude\", variable = \"CLAUDE_CODE_EXECUTABLE\" }\n";
        let second = listed_in(Path::new("h"), second).unwrap().remove(0);
        assert_eq!(
            second.in_project(project, data).env[SESSIONS_VARIABLE],
            claude.env[SESSIONS_VARIABLE],
            "every Claude account, one folder"
        );
    }

    #[test]
    fn a_new_id_needs_a_name_and_a_command_and_says_where() {
        let text =
            "[[harness]]\nid = \"claude\"\n\n[[harness]]\nid = \"gemini\"\nname = \"Gemini\"\n";
        let problem = listed_in(Path::new("h"), text).unwrap_err();
        assert!(
            problem.message.contains("needs a name and a command"),
            "{problem}"
        );
        assert_eq!(problem.line, Some(4), "{problem}");
    }
}
