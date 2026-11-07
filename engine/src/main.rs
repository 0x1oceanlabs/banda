//! `banda`: the engine and its CLI in one program.
//!
//! - `banda serve` runs this machine's engine. On Linux it runs as a
//!   service of the Person's session, which any command that reaches it
//!   starts when it does not run (ADR 0086, decision 1); `banda start` only
//!   starts it, `banda status` says whether it runs, since when and its
//!   build, and `banda stop` is Quit Banda (decision 3).
//! - `banda call <method>` calls one API method and prints `{"ok": …}`.
//! - `banda follow --project <id>` prints the Project's events, one JSON
//!   object per line.
//! - `banda project add <path>` adds a folder as a Project (ADR 0026) and
//!   prints it, as `banda call projects.add` does.
//! - `banda look` prints the window's look, resolved from Omarchy's
//!   theme, Hyprland and `~/.config/banda/look.toml`, with the sidebar's
//!   arrangement from `sidebar.toml` and the browser's from
//!   `browser.toml`; `--follow` prints it again on each change. It needs
//!   no engine: the look is this machine's.
//! - `banda --version` prints the version and the build id, by which the
//!   window checks its own copy of this program (ADR 0086, decision 2).
//! - `banda skill` prints the Banda skill, what an Agent needs to know to
//!   work in Banda and change it; `banda skill <topic>` prints a topic.
//! - `banda menu [route]` opens the Banda menu in the window, at a route
//!   such as `actions` or `project.<name>` (ADR 0017).
//! - `banda modules` prints what each module offers, one JSON object per
//!   line; `--unstable` lists the paths not in the contract yet (ADR 0022).
//! - `banda problems` prints what broke in Banda, one JSON object per
//!   line; `banda problems report <fingerprint>` prints one Problem's
//!   report, for an Agent or an issue (ADR 0039).
//! - `banda mcp` speaks MCP on stdio for an Agent in a Thread: the agents
//!   module hands it to each session, with the Agent's pass (ADR 0019).
//!
//! When the engine refuses (the call, the hello or the follow), the CLI
//! prints `{"error": {"code", "message"}}` and exits 1. When no engine
//! answers, or the program cannot do its part, it says so on stderr and
//! exits 2.

mod apps;
mod build_id;
mod client;
mod control;
mod files;
mod mcp;
mod modules;
mod parent;
mod places;
mod problems;
mod run;
mod serve;
mod service;

use banda_kernel::{CommandId, EventFilter, ProjectId, Refusal};
use clap::{Parser, Subcommand};
use client::Client;
use places::Places;
use serde_json::{Value, json};
use std::fmt::Display;
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "banda",
    version = env!("BANDA_VERSION"),
    about = "Banda: a tiling workspace for working with Agents."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Runs the engine for this computer.
    Serve {
        /// The port on 127.0.0.1. 0 takes the one it listened on last when
        /// that is free, else any free one.
        #[arg(long, default_value_t = 0)]
        port: u16,
        /// For a window that starts the engine: prints where it listens on
        /// the first line, and stops when stdin closes.
        #[arg(long)]
        with_parent: bool,
    },
    /// Starts the engine as this session's service when it does not run,
    /// as every command that reaches it does, and says how it runs, as
    /// `banda status` does.
    Start {
        /// For a window: prints where the engine listens on the first
        /// line, and follows it until stdin closes, which leaves it
        /// running, or until it stops. Where the engine is the window's
        /// child, this serves it, and stops it when stdin closes.
        #[arg(long)]
        with_parent: bool,
    },
    /// Says whether the engine runs, since when, and its build, as one
    /// JSON line. It starts nothing.
    Status,
    /// Quits Banda: stops the engine, its Agents, Harnesses and Terminals,
    /// and any window open on it. When Agents are working it asks first.
    Stop {
        /// Stops them without asking.
        #[arg(long)]
        force: bool,
    },
    /// Calls one API method and prints its answer as JSON.
    Call {
        /// For example projects.list or agents.send.
        method: String,
        // `--space` before ADR 0069 (grace).
        #[arg(long, alias = "space")]
        project: Option<ProjectId>,
        /// The method's parameters, as a JSON object.
        #[arg(long, default_value = "{}")]
        params: String,
        /// Repeats an earlier command safely: it runs once per ID.
        #[arg(long)]
        command: Option<CommandId>,
    },
    /// Adds a Project, as the window's "Add Project" does.
    // `banda space` before ADR 0069 (grace).
    #[command(alias = "space")]
    Project {
        #[command(subcommand)]
        what: ProjectCommand,
    },
    /// Snoozes a Thread, or wakes it (ADR 0074): snoozed, it leaves its
    /// Person's list until then.
    Thread {
        #[command(subcommand)]
        what: ThreadCommand,
    },
    /// Prints a Project's events, one JSON object per line.
    Follow {
        // `--space` before ADR 0069 (grace).
        #[arg(long, alias = "space")]
        project: ProjectId,
        /// Starts after this position in the Project's log.
        #[arg(long, default_value_t = 0)]
        after: i64,
        #[arg(long)]
        module: Option<String>,
        #[arg(long)]
        subject: Option<String>,
        /// Only events of this kind; give it more than once for more kinds.
        #[arg(long = "kind")]
        kinds: Vec<String>,
    },
    /// Prints the window's look as JSON: CSS variables from Omarchy's
    /// theme, Hyprland's windows and ~/.config/banda/look.toml, the
    /// sidebar's arrangement from ~/.config/banda/sidebar.toml, and the
    /// browser's from ~/.config/banda/browser.toml.
    Look {
        #[command(subcommand)]
        what: Option<LookCommand>,
        /// Prints it again, one JSON object per line, each time a file it
        /// reads changes or Hyprland reloads.
        #[arg(long)]
        follow: bool,
        /// For a window that follows the look: stops when stdin closes.
        #[arg(long, requires = "follow")]
        with_parent: bool,
    },
    /// Banda's settings files in ~/.config/banda: look.toml, sidebar.toml
    /// and harnesses.toml. Agents and people edit them; this checks them
    /// and prints what each may hold.
    Settings {
        #[command(subcommand)]
        what: SettingsCommand,
    },
    /// Banda's keys (ADR 0071): every action with its keys in force, and
    /// keys.toml's lines bound, freed and reset after the look's checks.
    /// With no command, the list.
    Keys {
        #[command(subcommand)]
        what: Option<KeysCommand>,
        /// The list as JSON, one action per line.
        #[arg(long)]
        json: bool,
    },
    /// Opens Files in Banda's window on a folder: PATH, or where this
    /// runs; a file opens its folder with it picked. It shows in the
    /// Project whose folder holds it, else in the first one.
    Files {
        /// The folder or the file: absolute, from ~, or from where this
        /// runs.
        path: Option<PathBuf>,
        /// The Project it shows in.
        #[arg(long)]
        project: Option<ProjectId>,
    },
    /// Opens the Banda menu in Banda's window, as Alt+Space does: at its
    /// root, or at ROUTE: `actions` (the key sheet), `views` (the
    /// sidebar's view), `project.add` ("Add Project"), `project.<name>` (a
    /// Project's Threads), or
    /// `settings.<section>.<row>` (the settings Pane there). Other
    /// words open it with them typed in.
    Menu { route: Option<String> },
    /// Prints the Banda skill: what an Agent needs to know to work in
    /// Banda and to change it for its Person, then its topics.
    Skill {
        /// Prints this topic instead.
        topic: Option<String>,
        /// Writes the skill into this folder as an Agent Skills folder,
        /// SKILL.md and references/, for a Harness to load.
        #[arg(long, conflicts_with = "topic")]
        export: Option<PathBuf>,
    },
    /// Prints what each module offers, one JSON object per line: its
    /// module.toml, its engine part's methods and its window part's
    /// Panes, actions and sources, each action with its keys by level
    /// and what it takes; the window's own, the tiling's, as `window`.
    Modules {
        /// Prints its unstable marks instead, the paths a module takes that
        /// are not in the contract yet, and how many against the ceiling.
        #[arg(long)]
        unstable: bool,
    },
    /// Prints what broke in Banda itself, the newest first, one JSON object
    /// per line: each Problem by its fingerprint, how often and how it broke
    /// the last time.
    Problems {
        #[command(subcommand)]
        what: Option<ProblemsCommand>,
    },
    /// Speaks MCP on stdio for an Agent in a Thread: the tools of Banda's
    /// methods, and the Banda skill. The agents module starts it for each
    /// session, with BANDA_TOKEN and BANDA_ENGINE.
    Mcp,
}

#[derive(Subcommand)]
enum ProblemsCommand {
    /// Prints one Problem's report in Markdown: what broke and where,
    /// Banda's version and system, the workspaces by their Panes' kinds
    /// (not under an Agent's pass, which sees none), and the last lines of
    /// the logs.
    Report {
        /// Its fingerprint, or as much of it as names one.
        fingerprint: String,
    },
}

#[derive(Subcommand)]
enum ProjectCommand {
    /// Adds a folder as a Project and prints it. A folder that already is
    /// one prints that Project, back from the archive if it was there.
    Add {
        /// The folder: absolute, from ~, or from where this runs.
        path: PathBuf,
        /// The Project's name; the folder's name when none is given.
        #[arg(long)]
        name: Option<String>,
        /// Makes the folder first when it does not exist.
        #[arg(long)]
        create: bool,
        /// Whether the Project is trusted, `trusted` in `projects.list`:
        /// true or false. Not given, a folder that looks foreign is not
        /// (`projects.foreign`).
        #[arg(long)]
        trusted: Option<bool>,
    },
}

#[derive(Subcommand)]
enum ThreadCommand {
    /// Snoozes a Thread for a while, or until a moment; with neither, a
    /// Thread at work until its turn ends. Anything that needs its Person
    /// wakes it early. In a Thread, an Agent's own is the default.
    Snooze {
        /// The Thread's ID; an Agent's own Thread when left out.
        thread: Option<String>,
        /// Its Project; `$BANDA_PROJECT` when left out, as in a Thread.
        #[arg(long)]
        project: Option<ProjectId>,
        /// How long: 30m, 2h, 1d.
        #[arg(long, conflicts_with = "until")]
        after: Option<String>,
        /// When it comes back, in milliseconds since the epoch.
        #[arg(long)]
        until: Option<i64>,
    },
    /// Wakes a snoozed Thread now; one awake stays so. In a Thread, an
    /// Agent's own is the default.
    Wake {
        /// The Thread's ID; an Agent's own Thread when left out.
        thread: Option<String>,
        /// Its Project; `$BANDA_PROJECT` when left out, as in a Thread.
        #[arg(long)]
        project: Option<ProjectId>,
    },
}

#[derive(Subcommand)]
enum LookCommand {
    /// Checks look.toml, sidebar.toml, a sidebar preset, browser.toml, a
    /// theme's banda.toml or colors.toml, or with no files every settings file,
    /// as `banda settings check` does. Prints path:line:column: problem
    /// and exits 1 when anything is wrong; prints nothing when all is well.
    Check { files: Vec<PathBuf> },
    /// Lists the themes there are, one JSON object per line.
    Themes,
}

#[derive(Subcommand)]
enum KeysCommand {
    /// Binds KEY to ACTION, as `Alt+M column.maximize`. Refuses, saying
    /// why, an action Banda has not, args it does not take, and a key
    /// the window's fields would type.
    Bind {
        key: String,
        action: String,
        /// What the action takes, as JSON: `{"address":"https://…"}`.
        #[arg(long, value_parser = |json: &str| serde_json::from_str::<banda_look::keys::Args>(json))]
        args: Option<banda_look::keys::Args>,
        /// The scope's table for an action of a scope, as `composer`.
        #[arg(long)]
        scope: Option<String>,
    },
    /// Frees KEY: it goes to the Pane.
    Free {
        key: String,
        #[arg(long)]
        scope: Option<String>,
    },
    /// Takes the Person's line of KEY out, so Banda's own is back.
    Reset {
        key: String,
        #[arg(long)]
        scope: Option<String>,
    },
    /// Sets the mod, one or two of Alt, Ctrl and Super, as `Ctrl+Alt`, and
    /// moves the Person's lines with it.
    Mod { keys: String },
}

#[derive(Subcommand)]
enum SettingsCommand {
    /// Checks the files given, or with none every settings file there
    /// is. Prints path:line:column: problem and exits 1 when anything is
    /// wrong; prints nothing when all is well.
    Check { files: Vec<PathBuf> },
    /// Prints a file's JSON Schema: every key it may hold, with its type
    /// and what it does. With no file, the list of files.
    Schema {
        #[arg(value_parser = file_names())]
        file: Option<String>,
        /// Writes every file's schema into the config folder's schemas/
        /// instead, where the files' `#:schema` lines point an editor.
        /// `banda look --follow` does it as it starts.
        #[arg(long, conflicts_with = "file")]
        export: bool,
    },
    /// Sets one key, as the settings Pane does, and leaves every other
    /// line and comment as it was. VALUE is TOML (`3`, `true`,
    /// `["a", "b"]`), or else taken as a string. Refuses, saying why
    /// as `check` does, when the file would then be wrong.
    Set {
        #[arg(value_parser = file_names())]
        file: String,
        /// Dotted: `tile.border`.
        key: String,
        value: String,
    },
    /// Takes one key out of the file, so the layer under it shows again.
    Reset {
        #[arg(value_parser = file_names())]
        file: String,
        key: String,
    },
    /// Names one key otherwise, where it is, its value and comments kept:
    /// `rename keys.toml 'binds."Alt+J"' Alt+Q` gives a line another key.
    Rename {
        #[arg(value_parser = file_names())]
        file: String,
        key: String,
        /// The key's new name, as is: `Alt+Q`.
        to: String,
    },
}

fn file_names() -> clap::builder::PossibleValuesParser {
    clap::builder::PossibleValuesParser::new(banda_settings::files().map(|file| file.name))
}

/// Why the program did not do its job, and how it exits.
pub enum Failure {
    /// The engine, or the CLI before it, refused: JSON on stdout, exit 1.
    Refused(Refusal),
    /// No engine answers, or this program could not do its part: plain
    /// words on stderr, exit 2.
    Broken(String),
}

impl Failure {
    pub fn broken(error: impl Display) -> Failure {
        Failure::Broken(error.to_string())
    }

    /// What went wrong, in plain words.
    pub fn words(self) -> String {
        match self {
            Failure::Refused(refusal) => refusal.message,
            Failure::Broken(words) => words,
        }
    }

    /// A command that broke off may have run: say how to repeat it safely.
    fn cut_short(self, command: CommandId) -> Failure {
        match self {
            Failure::Broken(words) => Failure::Broken(format!(
                "{words} The call may have run: repeat it safely with --command {command}"
            )),
            refused => refused,
        }
    }

    fn exit(self) -> ExitCode {
        match self {
            Failure::Refused(refusal) => {
                println!("{}", json!({ "error": refusal }));
                ExitCode::FAILURE
            }
            Failure::Broken(words) => {
                eprintln!("banda: {words}");
                ExitCode::from(2)
            }
        }
    }
}

fn main() -> ExitCode {
    banda_kernel::set_version(env!("BANDA_VERSION"));
    let cli = parse();
    match cli.command {
        Command::Look {
            what,
            follow,
            with_parent,
        } => return look(what, follow, with_parent),
        Command::Skill { topic, export } => return skill(topic, export),
        Command::Settings { what } => return settings(what),
        Command::Keys { what, json } => return keys(what, json),
        Command::Menu { route } => return menu(route.unwrap_or_default()),
        Command::Modules { unstable } => return print_modules(unstable),
        _ => {}
    }
    // How this Banda runs its engine, for `banda start`.
    let way = match cli.command {
        Command::Start { .. } => Some(service::way_here(&service::User)),
        _ => None,
    };
    // The engine keeps its panics and its log (ADR 0039, decision 1): as
    // `banda serve`, and as the window's child.
    let serving = match (&cli.command, way) {
        (Command::Serve { .. }, _)
        | (Command::Start { with_parent: true }, Some(service::Way::Child(_))) => {
            Places::from_env().ok()
        }
        _ => None,
    };
    if let Some(places) = &serving {
        banda_problems::catch_panics(places.problems());
    }
    logging(serving.map(|places| places.logs().join("engine.log")));
    let runtime = || tokio::runtime::Runtime::new().map_err(Failure::broken);
    let done = match (cli.command, way) {
        // It needs no places: its variables say where the engine is.
        (Command::Mcp, _) => runtime().and_then(|runtime| runtime.block_on(mcp::serve())),
        (Command::Start { with_parent }, Some(way)) => Places::from_env()
            .and_then(|places| runtime()?.block_on(control::start(places, with_parent, way))),
        (command, _) => {
            Places::from_env().and_then(|places| runtime()?.block_on(run(command, places)))
        }
    };
    match done {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => failure.exit(),
    }
}

/// The command line, with `--version` saying the build id after the
/// version, as `banda 0.3.0 (build 16da2821…)`: the window runs its copy of
/// this program once with it, and runs the copy only when it says what
/// the program it copied says (ADR 0086, decision 2).
fn parse() -> Cli {
    use clap::{CommandFactory, FromArgMatches};
    let version = match build_id::own() {
        Some(build) => format!("{} (build {build})", env!("BANDA_VERSION")),
        None => env!("BANDA_VERSION").to_owned(),
    };
    // clap takes a version that lives as long as the program.
    let version: &'static str = Box::leak(version.into_boxed_str());
    let matches = Cli::command().version(version).get_matches();
    Cli::from_arg_matches(&matches).unwrap_or_else(|error| error.exit())
}

/// The log, on stderr, and for the engine in `file` too, which starts
/// again past [`LOG_MOST`], the one before kept beside it.
fn logging(file: Option<PathBuf>) {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    use tracing_subscriber::{EnvFilter, fmt};
    let filter = EnvFilter::try_from_env("BANDA_LOG").unwrap_or_else(|_| "info".into());
    let kept = file.and_then(|path| match Rolling::open(path.clone()) {
        Ok(log) => Some(
            fmt::layer()
                .with_ansi(false)
                .with_writer(std::sync::Mutex::new(log)),
        ),
        Err(error) => {
            eprintln!("banda: {}: {error}", path.display());
            None
        }
    });
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(kept)
        .init();
}

/// The most a log grows to before it starts again.
const LOG_MOST: u64 = 4 << 20;

/// A log file for this user alone that, past [`LOG_MOST`], is kept as
/// `<name>.1.log` and starts again, as it opens and while it runs.
struct Rolling {
    path: PathBuf,
    file: std::fs::File,
    size: u64,
}

impl Rolling {
    fn open(path: PathBuf) -> std::io::Result<Rolling> {
        let file = banda_problems::append_private(&path)?;
        let size = file.metadata()?.len();
        let mut log = Rolling { path, file, size };
        if log.size > LOG_MOST {
            log.roll()?;
        }
        Ok(log)
    }

    fn roll(&mut self) -> std::io::Result<()> {
        std::fs::rename(&self.path, self.path.with_extension("1.log"))?;
        self.file = banda_problems::append_private(&self.path)?;
        self.size = 0;
        Ok(())
    }
}

impl std::io::Write for Rolling {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.size > LOG_MOST {
            self.roll()?;
        }
        let written = self.file.write(bytes)?;
        self.size += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

async fn run(command: Command, places: Places) -> Result<(), Failure> {
    match command {
        Command::Serve { port, with_parent } => serve::serve(places, port, with_parent).await,
        Command::Start { .. } => unreachable!("banda start knows how this Banda runs its engine"),
        Command::Status => control::status(&places).await,
        Command::Stop { force } => control::stop(&places, force).await,
        Command::Call {
            method,
            project,
            params,
            command,
        } => {
            let params: Value = serde_json::from_str(&params).map_err(|error| {
                Failure::Refused(Refusal::invalid(format!("--params is not JSON: {error}")))
            })?;
            print_call(
                &places,
                &method,
                project,
                command.unwrap_or_default(),
                params,
            )
            .await
        }
        Command::Project {
            what:
                ProjectCommand::Add {
                    path,
                    name,
                    create,
                    trusted,
                },
        } => {
            // `~` stays for the engine to read; a relative path is from here.
            let folder = match path.starts_with("~") {
                true => path,
                false => std::path::absolute(&path).map_err(Failure::broken)?,
            };
            let params = json!({
                "folder": folder.display().to_string(),
                "name": name,
                "create": create,
                "trusted": trusted,
            });
            print_call(&places, "projects.add", None, CommandId::new(), params).await
        }
        Command::Files { path, project } => files::open(&places, path, project).await,
        Command::Thread { what } => {
            let (method, project, params) = match what {
                ThreadCommand::Snooze {
                    thread,
                    project,
                    after,
                    until,
                } => {
                    let params = json!({ "thread": thread, "after": after, "until": until });
                    ("agents.snooze", project, params)
                }
                ThreadCommand::Wake { thread, project } => {
                    ("agents.wake", project, json!({ "thread": thread }))
                }
            };
            // In a Thread, the Agent's Project, by either of its names.
            let project = project.or_else(banda_kernel::project_from_env);
            print_call(&places, method, project, CommandId::new(), params).await
        }
        Command::Problems { what: None } => problems::list(&places).await,
        Command::Problems {
            what: Some(ProblemsCommand::Report { fingerprint }),
        } => problems::report(&places, &fingerprint).await,
        Command::Look { .. } => unreachable!("the look runs without the engine"),
        Command::Skill { .. } => unreachable!("the skill runs without the engine"),
        Command::Settings { .. } => unreachable!("the settings run without the engine"),
        Command::Keys { .. } => unreachable!("the keys run without the engine"),
        Command::Menu { .. } => unreachable!("the menu is the window's, not the engine's"),
        Command::Modules { .. } => {
            unreachable!("the modules say what they offer without the engine")
        }
        Command::Mcp => unreachable!("banda mcp finds the engine by its variables"),
        Command::Follow {
            project,
            after,
            module,
            subject,
            kinds,
        } => {
            let kinds = (!kinds.is_empty()).then_some(kinds);
            let filter = EventFilter {
                module,
                subject,
                kinds,
            };
            Client::connect(&places)
                .await?
                .follow(project, after, filter, |event| println!("{}", json!(event)))
                .await
        }
    }
}

/// Calls one method and prints its answer as `{"ok": …}`.
async fn print_call(
    places: &Places,
    method: &str,
    project: Option<ProjectId>,
    command: CommandId,
    params: Value,
) -> Result<(), Failure> {
    let answer = Client::connect(places)
        .await?
        .call(method, project, command, params)
        .await?;
    println!("{}", json!({ "ok": answer }));
    Ok(())
}

/// `banda modules`: what each module offers, no engine.
fn print_modules(unstable: bool) -> ExitCode {
    let offers = modules::offers();
    let mut out = std::io::stdout().lock();
    let lines: Vec<String> = if unstable {
        let marks = modules::marks(&offers);
        let mut lines: Vec<String> = marks
            .iter()
            .map(|(mark, why)| format!("{mark}: {why}"))
            .collect();
        lines.push(format!(
            "{} unstable marks, ceiling {}",
            marks.len(),
            modules::CEILING
        ));
        lines
    } else {
        offers
            .iter()
            .map(|offer| serde_json::to_string(offer).expect("an offer encodes"))
            .collect()
    };
    // A reader that went away is not an error.
    let _ = lines.iter().try_for_each(|line| writeln!(out, "{line}"));
    ExitCode::SUCCESS
}

/// `banda skill`: text built into the program, no engine.
fn skill(topic: Option<String>, export: Option<PathBuf>) -> ExitCode {
    use banda_skill::Reach;

    if let Some(folder) = export {
        return match banda_skill::export(&folder) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => Failure::Broken(format!("{}: {error}", folder.display())).exit(),
        };
    }
    let text = match banda_skill::read(topic.as_deref(), Reach::Command) {
        Ok(text) => text,
        Err(words) => return Failure::Broken(words).exit(),
    };
    let mut out = std::io::stdout().lock();
    // A reader that went away is not an error.
    let _ = write!(out, "{}", text.trim_end()).and_then(|()| writeln!(out));
    ExitCode::SUCCESS
}

/// Asks the window to open its menu at `route`: one JSON line to its
/// socket, and `ok` back.
fn menu(route: String) -> ExitCode {
    let told = Places::from_env()
        .and_then(|places| tell_window(&places.window(), &json!({ "menu": route })));
    match told {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => failure.exit(),
    }
}

#[cfg(unix)]
fn tell_window(socket: &std::path::Path, message: &Value) -> Result<(), Failure> {
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixStream;
    let mut stream = UnixStream::connect(socket)
        .map_err(|_| Failure::Broken("Banda's window is not open.".into()))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .map_err(Failure::broken)?;
    writeln!(stream, "{message}").map_err(Failure::broken)?;
    let mut answer = String::new();
    BufReader::new(stream)
        .read_line(&mut answer)
        .map_err(|error| Failure::Broken(format!("Banda's window did not answer: {error}")))?;
    match answer.trim() {
        "ok" => Ok(()),
        other => Err(Failure::Broken(format!("Banda's window said: {other}"))),
    }
}

#[cfg(not(unix))]
fn tell_window(_: &std::path::Path, _: &Value) -> Result<(), Failure> {
    Err(Failure::Broken("banda menu needs a Unix socket.".into()))
}

/// The look's places, in this Banda's config folder.
fn look_places() -> Result<banda_look::theme::Places, Failure> {
    Places::from_env().map(|places| banda_look::theme::Places::from_env(places.config))
}

/// `banda settings`: no engine, only the files (ADR 0016).
fn settings(what: SettingsCommand) -> ExitCode {
    let places = match look_places() {
        Ok(places) => places,
        Err(failure) => return failure.exit(),
    };
    match what {
        SettingsCommand::Check { files } => report(banda_settings::check(&places, &files)),
        SettingsCommand::Set { file, key, value } => {
            report_done(banda_settings::set(&places.config, &file, &key, &value))
        }
        SettingsCommand::Reset { file, key } => {
            report_done(banda_settings::reset(&places.config, &file, &key))
        }
        SettingsCommand::Rename { file, key, to } => {
            report_done(banda_settings::rename(&places.config, &file, &key, &to))
        }
        SettingsCommand::Schema { export: true, .. } => {
            let folder = places.config.join("schemas");
            match banda_settings::export(&folder) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => Failure::Broken(format!("{}: {error}", folder.display())).exit(),
            }
        }
        SettingsCommand::Schema { file, .. } => {
            let mut out = std::io::stdout().lock();
            // A reader that went away is not an error.
            let _ = match file.as_deref().and_then(banda_settings::file) {
                Some(file) => {
                    let schema = serde_json::to_string_pretty(&file.schema()).unwrap_or_default();
                    writeln!(out, "{schema}")
                }
                None => banda_settings::files()
                    .try_for_each(|file| writeln!(out, "{}\t{}", file.name, file.about())),
            };
            ExitCode::SUCCESS
        }
    }
}

/// `banda keys`: no engine, only the files, as `banda settings`.
fn keys(what: Option<KeysCommand>, json: bool) -> ExitCode {
    use banda_keys::{Bind, Key, SetMod};
    let places = match look_places() {
        Ok(places) => places,
        Err(failure) => return failure.exit(),
    };
    let config = &places.config;
    let Some(what) = what else {
        let (listed, problems) = banda_keys::list(config);
        let mut out = std::io::stdout().lock();
        for action in &listed {
            // A reader that went away is not an error.
            let _ = if json {
                writeln!(out, "{}", json!(action))
            } else {
                writeln!(out, "{}", line_of(action))
            };
        }
        return report(problems);
    };
    let done = match what {
        KeysCommand::Bind {
            key,
            action,
            args,
            scope,
        } => banda_keys::bind(
            config,
            &Bind {
                key,
                action,
                args,
                scope,
            },
        ),
        KeysCommand::Free { key, scope } => banda_keys::free(config, &Key { key, scope }),
        KeysCommand::Reset { key, scope } => banda_keys::reset(config, &Key { key, scope }),
        KeysCommand::Mod { keys } => banda_keys::set_mod(config, &SetMod { keys }),
    };
    report_done(done.map(|said| println!("{said}")))
}

/// An action as `banda keys` prints it: its id, its keys, mine marked
/// `*`, its scope and its title.
fn line_of(action: &banda_keys::Listed) -> String {
    let keys: Vec<String> = action
        .keys
        .iter()
        .map(|key| format!("{}{}", key.key, if key.mine { "*" } else { "" }))
        .collect();
    let scope = action
        .scope
        .as_deref()
        .map_or_else(String::new, |scope| format!(" [{scope}]"));
    format!(
        "{}\t{}{scope}\t{}",
        action.id,
        keys.join(", "),
        action.title
    )
}

/// A change's refusal, said as a check's problems are.
fn report_done(done: Result<(), Vec<banda_look::Problem>>) -> ExitCode {
    report(done.err().unwrap_or_default())
}

/// A check's problems on stderr, as a compiler says them: exit 1 when
/// there are any, and nothing said when all is well.
fn report(problems: Vec<banda_look::Problem>) -> ExitCode {
    for problem in &problems {
        eprintln!("{problem}");
    }
    if problems.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

/// `banda look`: no engine, no runtime, only files and Hyprland's socket.
fn look(what: Option<LookCommand>, follow: bool, with_parent: bool) -> ExitCode {
    use banda_look::hyprland::Hyprland;
    let places = match look_places() {
        Ok(places) => places,
        Err(failure) => return failure.exit(),
    };
    let mut out = std::io::stdout().lock();
    // A reader that went away is not an error: the window closed.
    let mut print =
        |value: serde_json::Value| writeln!(out, "{value}").and_then(|()| out.flush()).is_ok();
    match what {
        None if follow => {
            // The window's child goes with it, not at the next look it
            // would print to no one (ADR 0086, decision 2).
            if with_parent {
                parent::on_gone(|| std::process::exit(0));
            }
            // The window runs this as it starts: each settings file's
            // schema goes where the files' `#:schema` lines point.
            let schemas = places.config.join("schemas");
            if let Err(error) = banda_settings::export(&schemas) {
                eprintln!("banda: {}: {error}", schemas.display());
            }
            // The modules' files come with the look: the window reads the
            // browser's and the agents', and shows what is wrong in each.
            banda_look::follow(
                &places,
                Hyprland::from_env(),
                &banda_settings::also(),
                &banda_settings::manifests(),
                |look| print(json!(look)),
            );
            ExitCode::SUCCESS
        }
        None => {
            let hyprland = Hyprland::from_env();
            let windows = || hyprland.as_ref().and_then(|h| h.windows().ok());
            print(json!(
                banda_look::resolve(
                    &places,
                    &windows,
                    &banda_settings::also(),
                    &banda_settings::manifests(),
                )
                .look
            ));
            ExitCode::SUCCESS
        }
        Some(LookCommand::Themes) => {
            for theme in places.themes() {
                if !print(json!(theme)) {
                    break;
                }
            }
            ExitCode::SUCCESS
        }
        Some(LookCommand::Check { files }) => report(banda_settings::check(&places, &files)),
    }
}
