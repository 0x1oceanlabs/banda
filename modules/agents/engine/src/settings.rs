//! The agents module's settings are text files that people and Agents edit
//! (ADR 0002, decision 1): the Harness list, one per machine, says which
//! agent programs it can start.
//!
//! Before ADR 0006 a Space also had one file per Agent,
//! `.banda/agents/<name>.toml`, naming the Agent's Harness; since ADR 0026
//! they are in the Space's data, `spaces/<id>/agents/`. Only
//! [`old_agents`] reads them still, so the Threads from then learn their
//! Harness; nothing writes them, and nothing removes them.

use crate::model::{HarnessView, Mode, Offer, OptionValue, Program, Settings};
use banda_kernel::AgentId;
use banda_look::Problem;
use schemars::JsonSchema;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// An agent program and how to start it. It speaks ACP on its stdio.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Harness {
    /// How Threads and the window name it: `claude`, `codex`.
    pub id: String,
    /// What the Person reads: `Claude Code`.
    pub name: String,
    /// The program that speaks ACP: its name on PATH, or its path.
    pub command: String,
    /// Whether Threads start with it.
    pub enabled: bool,
    /// The program's arguments.
    pub args: Vec<String>,
    /// Variables over the environment it starts in.
    pub env: BTreeMap<String, String>,
    /// The Person's own CLI the program runs, when it runs one.
    pub cli: Option<Cli>,
    /// What a new Thread on it starts with.
    pub start: Start,
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
    /// An older CLI still runs, and its Threads warn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<String>,
}

impl Harness {
    /// The entry's own program with `args` after its arguments and `env`
    /// over its environment, as a Harness's sign-in in a terminal runs.
    pub fn program(&self, args: &[String], env: &HashMap<String, String>) -> Program {
        Program {
            program: self.command.clone(),
            args: self.args.iter().chain(args).cloned().collect(),
            env: self.env.clone().into_iter().chain(env.clone()).collect(),
        }
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
    /// The file the list follows, and its text when last read: none when
    /// it was not there. The text, not its time and size, tells a change,
    /// as the look's files do: two quick saves of one length share both.
    file: Option<(PathBuf, Option<String>)>,
}

/// The Harnesses this machine starts Threads with, in this order.
/// Without the file, Banda starts Claude Code and Codex, each with the
/// Person's own CLI.
#[derive(Deserialize, JsonSchema)]
pub struct HarnessFile {
    /// One `[[harness]]` table per agent program.
    #[serde(default)]
    #[schemars(with = "Vec<HarnessEntry>")]
    harness: Vec<toml::Spanned<HarnessEntry>>,
}

/// One `[[harness]]` table. An entry with the ID of a Harness Banda
/// knows, `claude` or `codex`, takes each key it leaves out from Banda:
/// so a Banda that moves an adapter to a newer version moves this
/// machine's too. Any other ID needs a `name` and a `command`.
#[derive(Deserialize, JsonSchema)]
pub struct HarnessEntry {
    /// How Threads and the window name it: `claude`, `codex`.
    pub id: String,
    /// What the Person reads: `Claude Code`.
    pub name: Option<String>,
    /// The program that speaks ACP: its name on PATH, or its path.
    pub command: Option<String>,
    /// Whether Threads start with it. One turned off stays in the list,
    /// with how it starts, for when it is turned on again.
    #[schemars(extend("default" = true))]
    pub enabled: Option<bool>,
    /// The program's arguments.
    pub args: Option<Vec<String>>,
    /// Variables over the environment it starts in.
    pub env: Option<BTreeMap<String, String>>,
    /// The Person's own CLI the program runs, when it runs one.
    pub cli: Option<Cli>,
    /// What a new Thread on it starts with.
    pub start: Option<Start>,
}

/// What a new Thread on a Harness starts with, over the Harness's own:
/// what it leaves out, the Harness chooses.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, JsonSchema)]
pub struct Start {
    /// How freely its Agent acts: "supervised", "accept_edits", "auto" or
    /// "full_access".
    pub mode: Option<Mode>,
    /// The Agent makes a plan before it changes anything.
    pub plan: Option<bool>,
    /// The Harness's options by their IDs, as its Threads offer them:
    /// `model = "opus"`.
    #[serde(flatten)]
    pub options: BTreeMap<String, OptionValue>,
}

impl Start {
    /// What a new Thread starts with: the Harness's own values for what
    /// it `offer`s, with this over them. An option the Harness does not
    /// offer, or a value it has not, is left out. Before it offered
    /// anything, this goes as written, and the Harness says what it does
    /// not take.
    pub fn over(&self, offer: Option<&Offer>) -> Settings {
        let mut settings = Settings::default();
        let Some(offer) = offer else {
            settings.options = self.options.clone();
            settings.mode = self.mode.unwrap_or_default();
            settings.plan = self.plan.unwrap_or_default();
            return settings;
        };
        for option in &offer.options {
            let value = self.options.get(&option.id).filter(|v| option.takes(v));
            let value = value.unwrap_or(&option.value);
            settings.options.insert(option.id.clone(), value.clone());
        }
        if let Some(mode) = self.mode {
            settings.mode = mode;
        }
        if let Some(plan) = self.plan.filter(|_| offer.plans) {
            settings.plan = plan;
        }
        settings
    }
}

impl HarnessEntry {
    /// The entry over Banda's own Harness of its ID, if Banda has one.
    /// Banda's arguments and CLI go with Banda's command: an entry that
    /// names another command says its own.
    fn harness(self) -> Result<Harness, String> {
        let mut base = known().into_iter().find(|known| known.id == self.id);
        if let (Some(base), Some(command)) = (&mut base, &self.command)
            && *command != base.command
        {
            base.args.clear();
            base.cli = None;
        }
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
        let base = base.map(|b| (b.args, b.env, b.cli, b.start));
        let (args, env, cli, start) = base.unwrap_or_default();
        Ok(Harness {
            id: self.id,
            name,
            command,
            enabled: self.enabled.unwrap_or(true),
            args: self.args.unwrap_or(args),
            env: self.env.unwrap_or(env),
            cli: self.cli.or(cli),
            start: self.start.unwrap_or(start),
            record: None,
        })
    }
}

impl Harnesses {
    pub fn new(harnesses: Vec<Harness>) -> Self {
        Self::with(harnesses, None)
    }

    fn with(harnesses: Vec<Harness>, file: Option<(PathBuf, Option<String>)>) -> Self {
        let harnesses = harnesses.into();
        Self(Arc::new(Mutex::new(List { harnesses, file })))
    }

    /// The Harnesses Banda starts when a machine names none: the ACP
    /// adapters for Claude Code and Codex, at versions we checked, each
    /// running the Person's own CLI. Each one signs in on its own; Banda
    /// holds no model provider's credentials.
    pub fn known() -> Self {
        Self::new(known())
    }

    /// Reads the Harness list at `path`: `[[harness]]` tables, each over
    /// Banda's own of its ID. A mistake says its line, as a check does.
    pub fn parse(path: &Path, text: &str) -> Result<Self, Problem> {
        parse(path, text).map(Self::new)
    }

    /// The machine's Harness list in `path`, followed from then on. A
    /// machine with no list gets the [`known`](Self::known) Harnesses.
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = read(path)?;
        let harnesses = listed(path, text.as_deref())?;
        Ok(Self::with(harnesses, Some((path.to_owned(), text))))
    }

    /// The list as its file says now. A file that changed into one that
    /// does not read is logged, and the list before it stays.
    fn now(&self) -> Arc<[Harness]> {
        let mut list = self.0.lock().unwrap();
        let List { harnesses, file } = &mut *list;
        if let Some((path, was)) = file {
            match read(path) {
                Ok(text) if text != *was => {
                    match listed(path, text.as_deref()) {
                        Ok(read) => *harnesses = read.into(),
                        Err(error) => tracing::warn!(%error, "the Harness list does not read"),
                    }
                    *was = text;
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "the Harness list cannot be read"),
            }
        }
        harnesses.clone()
    }

    pub fn find(&self, id: &str) -> Option<Harness> {
        self.now().iter().find(|h| h.id == id).cloned()
    }

    /// Entry `id`, when Threads may start with it.
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

fn known() -> Vec<Harness> {
    let npx = |id: &str,
               name: &str,
               package: &str,
               (program, variable, minimum): (&str, &str, &str)| Harness {
        id: id.to_owned(),
        name: name.to_owned(),
        command: "npx".to_owned(),
        args: vec!["-y".to_owned(), package.to_owned()],
        enabled: true,
        env: BTreeMap::new(),
        cli: Some(Cli {
            program: program.to_owned(),
            variable: variable.to_owned(),
            minimum: Some(minimum.to_owned()),
        }),
        start: Default::default(),
        record: None,
    };
    vec![
        npx(
            "claude",
            "Claude Code",
            "@agentclientprotocol/claude-agent-acp@0.99.1",
            // The adapter's Agent SDK 0.3.312 was built for Claude Code
            // 2.1.312 (its `claudeCodeVersion`).
            ("claude", "CLAUDE_CODE_EXECUTABLE", "2.1.312"),
        ),
        npx(
            "codex",
            "Codex",
            "@agentclientprotocol/codex-acp@2.5.0",
            // The adapter depends on `@openai/codex` ^0.165.0.
            ("codex", "CODEX_PATH", "0.165.0"),
        ),
    ]
}

fn parse(path: &Path, text: &str) -> Result<Vec<Harness>, Problem> {
    let file = toml::from_str::<HarnessFile>(text).map_err(|e| Problem::toml(path, text, &e))?;
    file.harness
        .into_iter()
        .map(|entry| {
            let span = entry.span();
            let wrong = |message| Problem::at(path, text, Some(span), message);
            entry.into_inner().harness().map_err(wrong)
        })
        .collect()
}

/// The file's text; none when it is not there.
fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

/// The list `text` says, or the known one when there is no file.
fn listed(path: &Path, text: Option<&str>) -> Result<Vec<Harness>, String> {
    match text {
        Some(text) => parse(path, text).map_err(|problem| problem.to_string()),
        None => Ok(known()),
    }
}

/// What is wrong in `text`, a `harnesses.toml` at `path`.
pub fn check(path: &Path, text: &str) -> Vec<Problem> {
    Harnesses::parse(path, text).err().into_iter().collect()
}

/// What `harnesses.toml` starts as when the settings Pane first writes
/// it: the known Harnesses by their IDs alone, so a change to one keeps
/// the others, and each takes how it starts from Banda.
pub fn template() -> String {
    let ids: String = known()
        .iter()
        .map(|harness| format!("\n[[harness]]\nid = {:?}\n", harness.id))
        .collect();
    format!(
        "#:schema ./schemas/harnesses.schema.json\n\
         # The Harnesses Banda starts Threads with, in this order. Without\n\
         # this file, the ones below. An entry with the ID of one Banda knows\n\
         # takes each key it leaves out from Banda, the adapter's version too;\n\
         # any other ID needs a name and a command. Check a change with:\n\
         # banda settings check\n{ids}"
    )
}

/// What an Agent's file from before ADR 0006 says: who it was and its
/// Harness. Anything else it holds is left as it is.
#[derive(Deserialize)]
struct AgentFile {
    id: AgentId,
    harness: String,
}

/// Each old Agent of a Space and its Harness. What cannot be read, a file
/// or the whole folder, is logged and skipped: the Space opens anyway, and
/// only the Threads it names miss their Harness.
pub fn old_agents(data: &Path) -> Vec<(AgentId, String)> {
    let folder = data.join("agents");
    let entries = match std::fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            tracing::warn!(folder = %folder.display(), %error, "the old Agents' folder cannot be read");
            return Vec::new();
        }
    };
    let mut agents = Vec::new();
    for path in entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
    {
        if path.extension().is_none_or(|e| e != "toml") {
            continue;
        }
        let parsed = std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|text| toml::from_str::<AgentFile>(&text).map_err(|e| e.to_string()));
        match parsed {
            Ok(file) => agents.push((file.id, file.harness)),
            Err(error) => {
                tracing::warn!(file = %path.display(), %error, "an old Agent's file does not parse")
            }
        }
    }
    agents
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_harness_list_reads_from_text() {
        let list = Harnesses::parse(
            Path::new("harnesses.toml"),
            r#"
            [[harness]]
            id = "fake"
            name = "Fake"
            command = "/bin/fake"
            args = ["--quiet"]
            "#,
        )
        .unwrap();
        let fake = list.find("fake").unwrap();
        assert_eq!(fake.args, ["--quiet"]);
        assert!(list.find("claude").is_none());
        assert!(Harnesses::parse(Path::new("h"), "harness = 3").is_err());
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
        assert_eq!(parse(Path::new("h"), &template()).unwrap(), known());
        assert!(
            !template().contains("@agentclientprotocol"),
            "no version is written down"
        );
    }

    #[test]
    fn a_known_id_takes_what_its_entry_leaves_out_from_banda() {
        let list = parse(
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

        let own = parse(
            Path::new("h"),
            "[[harness]]\nid = \"claude\"\ncommand = \"my-acp\"\n",
        )
        .unwrap();
        assert_eq!(own[0].name, "Claude Code");
        assert_eq!(
            (own[0].args.len(), own[0].cli.is_none()),
            (0, true),
            "Banda's arguments go with Banda's command"
        );
        let flag = "[[harness]]\nid = \"claude\"\ncommand = \"npx\"\nargs = [\"x\"]\n";
        let flag = parse(Path::new("h"), flag).unwrap();
        assert!(
            flag[0].cli.is_some(),
            "Banda's command still runs the Person's CLI"
        );
    }

    #[test]
    fn an_entry_says_what_a_new_thread_starts_with() {
        let text =
            "[[harness]]\nid = \"claude\"\n\n[harness.start]\nmode = \"auto\"\nmodel = \"opus\"\n";
        let claude = &parse(Path::new("h"), text).unwrap()[0];
        assert_eq!(claude.start.mode, Some(Mode::Auto));
        assert_eq!(
            claude.start.options,
            BTreeMap::from([("model".to_owned(), OptionValue::Choice("opus".to_owned()))])
        );
        assert_eq!(claude.args.len(), 2, "how it starts is still Banda's");
        let wrong = "[[harness]]\nid = \"claude\"\nstart = { mode = \"loose\" }\n";
        assert_eq!(parse(Path::new("h"), wrong).unwrap_err().line, Some(3));
    }

    #[test]
    fn a_new_id_needs_a_name_and_a_command_and_says_where() {
        let text =
            "[[harness]]\nid = \"claude\"\n\n[[harness]]\nid = \"gemini\"\nname = \"Gemini\"\n";
        let problem = parse(Path::new("h"), text).unwrap_err();
        assert!(
            problem.message.contains("needs a name and a command"),
            "{problem}"
        );
        assert_eq!(problem.line, Some(4), "{problem}");
    }

    #[test]
    fn old_agent_files_name_their_harness() {
        let data = tempfile::tempdir().unwrap();
        assert!(old_agents(data.path()).is_empty());
        let folder = data.path().join("agents");
        std::fs::create_dir_all(&folder).unwrap();
        let id = AgentId::new();
        let text = format!("id = \"{id}\"\nharness = \"codex\"\nmode = \"supervised\"\n");
        std::fs::write(folder.join("Writer.toml"), text).unwrap();
        std::fs::write(folder.join("Broken.toml"), "id = 3").unwrap();
        std::fs::write(folder.join("notes.txt"), "not an Agent").unwrap();
        assert_eq!(old_agents(data.path()), vec![(id, "codex".to_owned())]);
    }
}
