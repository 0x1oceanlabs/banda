//! `banda`: the engine and its CLI in one program.
//!
//! - `banda serve` runs this machine's engine.
//! - `banda call <method>` calls one API method and prints `{"ok": …}`.
//! - `banda follow --space <id>` prints the Space's events, one JSON
//!   object per line.
//! - `banda space add <path>` adds a folder as a Space (ADR 0026) and
//!   prints it, as `banda call spaces.add` does.
//! - `banda look` prints the window's look, resolved from Omarchy's
//!   theme, Hyprland and `~/.config/banda/look.toml`, with the sidebar's
//!   arrangement from `sidebar.toml` and the browser's from
//!   `browser.toml`; `--follow` prints it again on each change. It needs
//!   no engine: the look is this machine's.
//! - `banda skill` prints the Banda skill, what an Agent needs to know to
//!   work in Banda and change it; `banda skill <topic>` prints a topic.
//! - `banda menu [route]` opens the Banda menu in the window, at a route
//!   such as `actions` or `space.<name>` (ADR 0017).
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

mod client;
mod mcp;
mod modules;
mod places;
mod problems;
mod serve;

use banda_kernel::{CommandId, EventFilter, Refusal, SpaceId};
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
        /// The port on 127.0.0.1. 0 picks a free one.
        #[arg(long, default_value_t = 0)]
        port: u16,
        /// For a window that starts the engine: prints where it listens on
        /// the first line, and stops when stdin closes.
        #[arg(long)]
        with_parent: bool,
    },
    /// Calls one API method and prints its answer as JSON.
    Call {
        /// For example spaces.list or agents.send.
        method: String,
        #[arg(long)]
        space: Option<SpaceId>,
        /// The method's parameters, as a JSON object.
        #[arg(long, default_value = "{}")]
        params: String,
        /// Repeats an earlier command safely: it runs once per ID.
        #[arg(long)]
        command: Option<CommandId>,
    },
    /// Adds a Space, as the window's "Add Space" does.
    Space {
        #[command(subcommand)]
        what: SpaceCommand,
    },
    /// Prints a Space's events, one JSON object per line.
    Follow {
        #[arg(long)]
        space: SpaceId,
        /// Starts after this position in the Space's log.
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
    },
    /// Banda's settings files in ~/.config/banda: look.toml, sidebar.toml
    /// and harnesses.toml. Agents and people edit them; this checks them
    /// and prints what each may hold.
    Settings {
        #[command(subcommand)]
        what: SettingsCommand,
    },
    /// Opens the Banda menu in Banda's window, as Alt+Space does: at its
    /// root, or at ROUTE: `actions` (the key sheet), `views` (the
    /// sidebar's view), `space.add` ("Add Space"), `space.<name>` (a
    /// Space's Threads), or
    /// `settings.<section>.<row>` (the settings Pane there). Other
    /// words open it with them typed in.
    Menu { route: Option<String> },
    /// Prints the CDP endpoint of the browser in Banda's window, for an
    /// Agent's tool: Playwright's `connectOverCDP`, Playwright MCP's
    /// `--cdp-endpoint`, Chrome DevTools MCP's `--browser-url`. Its
    /// targets are the browser's tabs. `banda skill browser` says more.
    Browser {
        /// Prints the browser's WebSocket instead, for a tool that takes
        /// only that.
        #[arg(long)]
        web_socket: bool,
    },
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
    /// Panes, actions and sources.
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
    /// Banda's version and system, the workspaces by their Panes' kinds,
    /// and the last lines of the logs.
    Report {
        /// Its fingerprint, or as much of it as names one.
        fingerprint: String,
    },
}

#[derive(Subcommand)]
enum SpaceCommand {
    /// Adds a folder as a Space and prints it. A folder that already is
    /// one prints that Space, back from the archive if it was there.
    Add {
        /// The folder: absolute, from ~, or from where this runs.
        path: PathBuf,
        /// The Space's name; the folder's name when none is given.
        #[arg(long)]
        name: Option<String>,
        /// Makes the folder first when it does not exist.
        #[arg(long)]
        create: bool,
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
    let cli = Cli::parse();
    match cli.command {
        Command::Look { what, follow } => return look(what, follow),
        Command::Skill { topic, export } => return skill(topic, export),
        Command::Settings { what } => return settings(what),
        Command::Menu { route } => return menu(route.unwrap_or_default()),
        Command::Modules { unstable } => return print_modules(unstable),
        Command::Browser { web_socket } => return browser(web_socket),
        _ => {}
    }
    // The engine keeps its panics and its log (ADR 0039, decision 1).
    let serving = match cli.command {
        Command::Serve { .. } => Places::from_env().ok(),
        _ => None,
    };
    if let Some(places) = &serving {
        banda_problems::catch_panics(places.problems());
    }
    logging(serving.map(|places| places.logs().join("engine.log")));
    let runtime = || tokio::runtime::Runtime::new().map_err(Failure::broken);
    let done = match cli.command {
        // It needs no places: its variables say where the engine is.
        Command::Mcp => runtime().and_then(|runtime| runtime.block_on(mcp::serve())),
        command => Places::from_env().and_then(|places| runtime()?.block_on(run(command, places))),
    };
    match done {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => failure.exit(),
    }
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
        Command::Call {
            method,
            space,
            params,
            command,
        } => {
            let params: Value = serde_json::from_str(&params).map_err(|error| {
                Failure::Refused(Refusal::invalid(format!("--params is not JSON: {error}")))
            })?;
            print_call(&places, &method, space, command.unwrap_or_default(), params).await
        }
        Command::Space {
            what: SpaceCommand::Add { path, name, create },
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
            });
            print_call(&places, "spaces.add", None, CommandId::new(), params).await
        }
        Command::Problems { what: None } => problems::list(&places).await,
        Command::Problems {
            what: Some(ProblemsCommand::Report { fingerprint }),
        } => problems::report(&places, &fingerprint).await,
        Command::Look { .. } => unreachable!("the look runs without the engine"),
        Command::Skill { .. } => unreachable!("the skill runs without the engine"),
        Command::Settings { .. } => unreachable!("the settings run without the engine"),
        Command::Menu { .. } => unreachable!("the menu is the window's, not the engine's"),
        Command::Modules { .. } => {
            unreachable!("the modules say what they offer without the engine")
        }
        Command::Browser { .. } => unreachable!("the browser is the window's, not the engine's"),
        Command::Mcp => unreachable!("banda mcp finds the engine by its variables"),
        Command::Follow {
            space,
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
                .follow(space, after, filter, |event| println!("{}", json!(event)))
                .await
        }
    }
}

/// Calls one method and prints its answer as `{"ok": …}`.
async fn print_call(
    places: &Places,
    method: &str,
    space: Option<SpaceId>,
    command: CommandId,
    params: Value,
) -> Result<(), Failure> {
    let answer = Client::connect(places)
        .await?
        .call(method, space, command, params)
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

/// What the window writes in `browser.json` while it is open.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserEndpoint {
    endpoint: String,
    web_socket: String,
    port: u16,
}

/// Prints where the window's browser takes CDP clients, once something
/// listens there: a window that crashed leaves its file behind.
fn browser(web_socket: bool) -> ExitCode {
    let said = Places::from_env().and_then(|places| {
        let closed = || Failure::Broken("Banda's window is not open.".into());
        let bytes = std::fs::read(places.browser()).map_err(|_| closed())?;
        let said: BrowserEndpoint = serde_json::from_slice(&bytes).map_err(Failure::broken)?;
        let address = (places::HOST, said.port);
        std::net::TcpStream::connect(address).map_err(|_| closed())?;
        Ok(if web_socket {
            said.web_socket
        } else {
            said.endpoint
        })
    });
    match said {
        Ok(line) => {
            println!("{line}");
            ExitCode::SUCCESS
        }
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
fn look(what: Option<LookCommand>, follow: bool) -> ExitCode {
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
                |look| print(json!(look)),
            );
            ExitCode::SUCCESS
        }
        None => {
            let hyprland = Hyprland::from_env();
            let windows = || hyprland.as_ref().and_then(|h| h.windows().ok());
            print(json!(
                banda_look::resolve(&places, &windows, &banda_settings::also()).look
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
