//! `banda`: the engine and its CLI in one program.
//!
//! - `banda serve` runs this machine's engine. It runs as a service of the
//!   Person's session, a systemd unit on Linux and a launchd job on macOS,
//!   which any command that reaches it starts when it does not run (ADR
//!   0086, decision 1); `banda start` only starts it, `banda status` says
//!   whether it runs, since when and its build, and who works and who
//!   waits on this machine, `--follow` on each change, for the bar (decision
//!   4), and `banda stop` is Quit Banda (decision 3).
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
//! - `banda account` discovers, connects and manages Accounts through the
//!   engine, with the caller's pass (ADR 0104), as filters: the result
//!   alone on stdout, a list one JSON object a line, IDs on stdin for `-`,
//!   a refusal on stderr (ADR 0108, decision 3).
//! - `banda machine` prints what this machine is called and drawn by, its
//!   name and icon, as its engine says them to every window.
//! - `banda --version` prints the version and the build id, by which the
//!   window checks its own copy of this program (ADR 0086, decision 2).
//! - `banda skill` prints the Banda skill, what an Agent needs to know to
//!   work in Banda and change it; `banda skill <topic>` prints a topic.
//! - `banda menu [route]` opens the Banda menu in the window, at a route
//!   such as `actions` or `project.<name>` (ADR 0017).
//! - `banda act <id>` runs one of Banda's actions in the window, as its
//!   key does, and prints `{"ok": …}` (ADR 0127, decision 2).
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
//! exits 2. `banda start --with-parent` run over ssh for another machine's
//! window exits 75 while no engine runs where it starts none: a Mac with
//! nobody logged in at its screen, or where the engine would be that
//! window's child off Linux; or once the Mac's job stops as the Person
//! logs out at its screen (`control.rs`). `banda start --with-parent` for
//! a window here exits 3 once the engine stopped as asked, but not by
//! Quit Banda: the window stays, and starts it only when the Person says.

mod account;
mod act;
mod app;
mod apps;
mod build_id;
// macOS's engine stops what a crashed one left; Linux's unit does (ADR
// 0086, decision 1). Its tests run on every Unix.
#[cfg(any(target_os = "macos", all(test, unix)))]
mod children;
mod client;
mod control;
mod devices;
mod export;
mod fence;
mod files;
mod mcp;
mod modules;
mod moving;
mod page;
mod parent;
mod places;
mod problems;
mod quit;
mod run;
mod serve;
mod service;
mod status;
mod window;

use banda_kernel::{CommandId, EventFilter, ProjectId, Refusal};
use clap::{Parser, Subcommand};
use client::Client;
use places::Places;
use serde_json::{Value, json};
use std::ffi::OsString;
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
        /// The engine's launchd job, started again by itself with the
        /// login shell's PATH (macOS): it says so, and nothing else does.
        #[arg(long, hide = true)]
        job: bool,
    },
    /// Starts the engine as this session's service when it does not run,
    /// as every command that reaches it does, and says how it runs, as
    /// `banda status` does.
    Start {
        /// For a window: prints where the engine listens on the first
        /// line, and follows it until stdin closes, which leaves it
        /// running, or until it stops. Where the engine is the window's
        /// child, this serves it, and stops it when stdin closes; but for
        /// another machine's window, over ssh, where the engine would be
        /// its child off Linux, as on a Mac with nobody logged in at its
        /// screen, it only follows the one that runs there.
        #[arg(long)]
        with_parent: bool,
    },
    /// Says whether the engine runs, since when, and its build, what this
    /// machine is: its system, and its own name and icon; and who works
    /// and who waits on it; as one JSON line. It starts nothing.
    Status {
        /// Prints a line again on each change, the current one first: with
        /// no engine, it says so and waits for one.
        #[arg(long)]
        follow: bool,
        /// For a bar that follows it: stops when stdin closes.
        #[arg(long, requires = "follow")]
        with_parent: bool,
    },
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
    /// This machine's updates (ADR 0119): what it runs, the newest its
    /// channel has, what it takes and what is ready, as one JSON line.
    ///
    /// The engine moves onto a copy in place by itself once no Turn runs,
    /// no terminal is open and no key reached one for ten minutes, as
    /// machine.toml's `updates` says ("when-idle", "ask" or "off").
    Update {
        /// Looks at the channel now, and takes the newest engine when it is
        /// newer, then says what it found.
        #[arg(long)]
        check: bool,
        /// Puts this version in place, an older one too, and keeps to it:
        /// the engine moves onto it as onto any new copy, and takes none
        /// above it. `newest` takes the newest again.
        #[arg(long, value_name = "VERSION")]
        version: Option<String>,
        /// Restarts the engine on the copy in place now, which ends its
        /// terminals; while Agents work, it asks first, as Quit does.
        #[arg(long)]
        now: bool,
        /// With --now: restarts while Agents work, without asking.
        #[arg(long, requires = "now")]
        force: bool,
        /// Prints a line again on each change, the current one first.
        #[arg(long, conflicts_with_all = ["check", "version", "now"])]
        follow: bool,
    },
    /// Prints what this machine is called and drawn by, as every window
    /// shows it: its name, a tab, and its icon. machine.toml in
    /// ~/.config/banda names it; Settings → Machines writes that.
    Machine {
        /// One JSON object instead: {"name", "icon"}.
        #[arg(long)]
        json: bool,
    },
    /// Puts a Thread off, or wakes it (ADR 0074): put off, it leaves its
    /// Person's list until then.
    Thread {
        #[command(subcommand)]
        what: ThreadCommand,
    },
    /// Prints a Project's events, one JSON object per line; with
    /// `--machine`, those of the machine's modules, as `harnesses`'.
    Follow {
        // `--space` before ADR 0069 (grace).
        #[arg(long, alias = "space", required_unless_present = "machine")]
        project: Option<ProjectId>,
        /// The machine's own log, instead of a Project's.
        #[arg(long, conflicts_with = "project")]
        machine: bool,
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
    /// The Apps installed on this machine from a folder, which a Person's
    /// Agent writes: start a new one, install one, list them, remove one.
    App {
        #[command(subcommand)]
        what: app::AppCommand,
    },
    /// Prints what an App keeps in a Project, as lines anyone can read:
    /// its ledger and its tables' CREATE, its events, then each table a
    /// row a line, each JSON line naming the file of the export it is of.
    /// It reads the data whether the App is installed or not.
    Export {
        /// The App's id, as `clients`, or one of Banda's own.
        #[arg(long)]
        app: String,
        /// The Project; `$BANDA_PROJECT` when left out, as in a terminal
        /// Banda started.
        #[arg(long)]
        project: Option<ProjectId>,
        /// Writes the export in this folder instead, as `<app>/app.json`,
        /// `<app>/events.ndjson` and a `<app>/<table>.ndjson` for each
        /// table.
        #[arg(long)]
        to: Option<PathBuf>,
    },
    /// Connect and manage Accounts through the engine, as this caller.
    Account {
        #[command(subcommand)]
        what: account::AccountCommand,
    },
    /// The devices this machine lets in at its door, each by its own key:
    /// lists them, pairs one, or removes one.
    Devices {
        #[command(subcommand)]
        what: devices::DevicesCommand,
    },
    /// A gateway account's key, kept in this machine's keyring (ADR 0078,
    /// decision 1).
    Secret {
        #[command(subcommand)]
        what: account::SecretCommand,
    },
    /// Banda's settings files in ~/.config/banda: look.toml, sidebar.toml
    /// and harnesses.toml. Agents and people edit them; this checks them
    /// and prints what each may hold.
    Settings {
        #[command(subcommand)]
        what: SettingsCommand,
    },
    /// Banda's keys (ADR 0071): every action with its keys in force and
    /// whose it is, and keys.toml's lines bound, freed and reset after the
    /// look's checks.
    /// With no command, the list.
    Keys {
        #[command(subcommand)]
        what: Option<KeysCommand>,
        /// The list as JSON, one action per line.
        #[arg(long)]
        json: bool,
    },
    /// Runs one of Banda's actions in the window, by its id, as its key
    /// does: `banda act overview.toggle` shows the Overview. `banda keys`
    /// lists every action, what it takes and the scope it works in: an
    /// action of a scope runs for the Pane in focus. It prints what the
    /// engine said as one JSON line, and exits 1, saying why, for an
    /// action Banda has not, args it does not take, and a window that is
    /// not open or does not run it.
    Act {
        /// The action's id, as `overview.toggle` or `terminal.new`.
        id: String,
        /// What the action takes, as JSON: `{"address":"https://…"}`.
        #[arg(long, value_parser = |json: &str| serde_json::from_str::<banda_look::keys::Args>(json))]
        args: Option<banda_look::keys::Args>,
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
    /// app.toml, its engine part's methods and its window part's
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
    /// Runs a program behind the fence (ADR 0083, decision 1): the engine
    /// starts it so, from its own program, with the spec on an fd.
    #[command(hide = true)]
    Fence {
        /// Prints whether the fence holds here as one JSON line: over the
        /// spec on --spec-fd, else over this Banda's own folders.
        #[arg(long)]
        probe: bool,
        /// The sealed memfd that holds the spec.
        #[arg(long)]
        spec_fd: Option<i32>,
        /// A pipe to say on whether the program started: it ends with
        /// nothing said once it runs.
        #[arg(long)]
        status_fd: Option<i32>,
        /// The program, by its path or name, and its arguments.
        #[arg(last = true)]
        program: Vec<OsString>,
    },
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
    /// Puts a Thread off for a while, until a moment, or Someday; with
    /// none, a Thread at work until its turn ends. Anything that needs its Person
    /// wakes it early. In a Thread, an Agent's own is the default.
    #[command(alias = "snooze")]
    Later {
        /// The Thread's ID; an Agent's own Thread when left out.
        thread: Option<String>,
        /// Its Project; `$BANDA_PROJECT` when left out, as in a Thread.
        #[arg(long)]
        project: Option<ProjectId>,
        /// How long: 30m, 2h, 1d.
        #[arg(long, conflicts_with = "until")]
        after: Option<String>,
        /// When it comes back, in milliseconds since the epoch.
        #[arg(long, conflicts_with = "someday")]
        until: Option<i64>,
        /// Someday: no time, and it never wakes by itself.
        #[arg(long, conflicts_with = "after")]
        someday: bool,
    },
    /// Wakes a put-off Thread now; one awake stays so. In a Thread, an
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
    /// theme's theme.toml, banda.toml or colors.toml, or with no files every
    /// settings file, as `banda settings check` does. Prints
    /// path:line:column: problem and exits 1 when anything is wrong; prints
    /// nothing when all is well.
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
    /// The engine, or the CLI before it, refused: JSON on stdout, exit 1;
    /// on stderr for a filter, whose stdout holds only its result (ADR
    /// 0108, decision 3).
    Refused(Refusal),
    /// No engine answers, or this program could not do its part: plain
    /// words on stderr, exit 2.
    Broken(String),
    /// Nothing to do yet, for a caller that tries again later: plain words
    /// on stderr, exit 75, sysexits' `EX_TEMPFAIL`. Only `banda start
    /// --with-parent` over ssh says it, while no engine runs where it
    /// starts none, as on a Mac with nobody logged in at its screen, or
    /// once the Mac's job stops as the Person logs out at its screen.
    Later(String),
    /// The engine stopped as it was asked to, but not by Quit Banda: plain
    /// words on stderr, exit 3. Only `banda start --with-parent` for a
    /// window here says it: that window stays, says the engine is stopped,
    /// and starts it again when the Person says (ADR 0124, decision 9).
    Stopped(String),
}

impl Failure {
    pub fn broken(error: impl Display) -> Failure {
        Failure::Broken(error.to_string())
    }

    /// What went wrong, in plain words.
    pub fn words(self) -> String {
        match self {
            Failure::Refused(refusal) => refusal.message,
            Failure::Broken(words) | Failure::Later(words) | Failure::Stopped(words) => words,
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

    /// A refusal as the CLI prints it.
    pub fn said(refusal: &Refusal) -> Value {
        json!({ "error": refusal })
    }

    /// Ends the program.
    fn exit(self) -> ExitCode {
        self.end(false)
    }

    /// Ends the program; a `filter`'s refusal goes to stderr.
    fn end(self, filter: bool) -> ExitCode {
        match self {
            Failure::Refused(refusal) if filter => {
                eprintln!("{}", Failure::said(&refusal));
                ExitCode::FAILURE
            }
            Failure::Refused(refusal) => {
                println!("{}", Failure::said(&refusal));
                ExitCode::FAILURE
            }
            Failure::Broken(words) => {
                eprintln!("banda: {words}");
                ExitCode::from(2)
            }
            Failure::Later(words) => {
                eprintln!("banda: {words}");
                ExitCode::from(75)
            }
            Failure::Stopped(words) => {
                eprintln!("banda: {words}");
                ExitCode::from(3)
            }
        }
    }
}

fn main() -> ExitCode {
    banda_kernel::set_version(env!("BANDA_VERSION"));
    let mut cli = parse();
    // The engine's launchd job starts itself again first, with the login
    // shell's PATH, before anything else runs (macOS); from here on `job`
    // says whether this is the job.
    if let Command::Serve { job, .. } = &mut cli.command {
        *job = service::launchd::begin(*job);
        // What its welcome says to every window (ADR 0119, decision 6).
        banda_kernel::set_build(build_id::own());
    }
    match cli.command {
        // Before anything else: it stays on this one thread.
        Command::Fence {
            probe,
            spec_fd,
            status_fd,
            program,
        } => return fence::run(probe, spec_fd, status_fd, program),
        Command::Look {
            what,
            follow,
            with_parent,
        } => return look(what, follow, with_parent),
        Command::Skill { topic, export } => return skill(topic, export),
        Command::Settings { what } => return settings(what),
        Command::Keys { what, json } => return keys(what, json),
        Command::Menu { route } => return window::menu(route.unwrap_or_default()),
        Command::Modules { unstable } => return print_modules(unstable),
        _ => {}
    }
    // How this Banda runs its engine, for `banda start`.
    let way = match cli.command {
        Command::Start { .. } => Some(service::way_here()),
        _ => None,
    };
    // What `start` may start, for another machine's window over ssh too;
    // where it starts nothing, it only follows the engine.
    let starts = way.map(|way| control::starts(way, control::over_ssh_here()));
    let only = starts == Some(control::Starts::Nothing);
    // The engine keeps its panics and its log (ADR 0039, decision 1): as
    // `banda serve`, and as the window's child; not where `start` only
    // follows it.
    let serving = match (&cli.command, way) {
        (Command::Serve { .. }, _) => Places::from_env().ok(),
        (Command::Start { with_parent: true }, Some(service::Way::Child(_))) if !only => {
            Places::from_env().ok()
        }
        _ => None,
    };
    if let Some(places) = &serving {
        banda_problems::catch_panics(places.problems());
    }
    // launchd's job logs to its file alone: its stderr is a file of
    // launchd's that never starts again.
    let job = matches!(cli.command, Command::Serve { job: true, .. });
    logging(serving.map(|places| places.logs().join("engine.log")), !job);
    let runtime = || tokio::runtime::Runtime::new().map_err(Failure::broken);
    // `banda account` and `banda secret` keep stdout for results alone; the
    // rest of `banda` follows as its own change (ADR 0108, decision 3).
    let filter = matches!(
        cli.command,
        Command::Account { .. } | Command::Secret { .. }
    );
    let done = match (cli.command, way.zip(starts)) {
        // It needs no places: its variables say where the engine is.
        (Command::Mcp, _) => runtime().and_then(|runtime| runtime.block_on(mcp::serve())),
        (Command::Start { with_parent }, Some((way, starts))) => {
            Places::from_env().and_then(|places| {
                runtime()?.block_on(control::start(places, with_parent, way, starts))
            })
        }
        (command, _) => {
            Places::from_env().and_then(|places| runtime()?.block_on(run(command, places)))
        }
    };
    // The engine stopped to move onto its new copy, its runtime gone:
    // the copy runs in its place (ADR 0119, decision 3).
    #[cfg(unix)]
    let done = match (done, moving::onto()) {
        (Ok(()), Some(program)) => Err(moving::exec(program)),
        (done, _) => done,
    };
    match done {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => failure.end(filter),
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

/// The log, on stderr unless not `to_stderr`, and for the engine in `file`
/// too, which starts again past [`LOG_MOST`], the one before kept beside
/// it.
fn logging(file: Option<PathBuf>, to_stderr: bool) {
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
    let stderr = to_stderr.then(|| fmt::layer().with_writer(std::io::stderr));
    tracing_subscriber::registry()
        .with(filter)
        .with(stderr)
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
        banda_kernel::host::rename(&self.path, &self.path.with_extension("1.log"))?;
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
        Command::Serve {
            port,
            with_parent,
            job,
        } => {
            let serving = serve::Serving {
                port,
                with_parent,
                job,
                child: None,
            };
            serve::serve(places, serving).await
        }
        Command::Start { .. } => unreachable!("banda start knows how this Banda runs its engine"),
        Command::Status {
            follow,
            with_parent,
        } => status::status(&places, follow, with_parent).await,
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
        Command::App { what } => app::app(&places, what).await,
        Command::Export { app, project, to } => {
            let project = project.or_else(banda_kernel::project_from_env).ok_or_else(|| {
                Failure::Refused(Refusal::invalid(
                    "Name the Project: --project <id>, as `banda call projects.list` lists them.",
                ))
            })?;
            export::export(&places, app, project, to).await
        }
        Command::Account { what } => account::account(&places, what).await,
        Command::Devices { what } => devices::devices(&places, what).await,
        Command::Secret { what } => account::secret(&places, what).await,
        Command::Act { id, args } => act::act(&places, id, args).await,
        Command::Files { path, project } => files::open(&places, path, project).await,
        Command::Machine { json } => machine(&places, json).await,
        Command::Update {
            check,
            version,
            now,
            force,
            follow,
        } => {
            let update = Update {
                check,
                version,
                now,
                force,
                follow,
            };
            self::update(&places, update).await
        }
        Command::Thread { what } => {
            let (method, project, params) = match what {
                ThreadCommand::Later {
                    thread,
                    project,
                    after,
                    until,
                    someday,
                } => {
                    let params = json!({
                        "thread": thread, "after": after, "until": until, "someday": someday,
                    });
                    ("agents.later", project, params)
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
        Command::Fence { .. } => unreachable!("the fence runs before anything else"),
        Command::Follow {
            project,
            // Said by the absence of `project`.
            machine: _,
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
            let mut client = Client::connect(&places).await?;
            let project = match project {
                Some(project) => project,
                None => client.machine().ok_or_else(|| {
                    Failure::Refused(Refusal::not_found(
                        "This engine runs no machine module, so its machine has no log.",
                    ))
                })?,
            };
            client
                .follow(project, after, filter, |event| println!("{}", json!(event)))
                .await
        }
    }
}

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

/// What `banda update` is asked.
struct Update {
    check: bool,
    version: Option<String>,
    now: bool,
    force: bool,
    follow: bool,
}

/// `banda update`: the updates module's state, looked at now with
/// `check`, or each change of it with `follow`; a version put in place
/// with `version`, and the engine restarted on the copy in place with
/// `now`, in that order. One JSON line for each.
async fn update(places: &Places, asked: Update) -> Result<(), Failure> {
    let mut client = Client::connect(places).await?;
    let acts = asked.check || asked.version.is_some() || asked.now;
    if asked.check {
        let found = client
            .call("updates.check", None, CommandId::new(), json!({}))
            .await?;
        println!("{found}");
    }
    if let Some(version) = &asked.version {
        let taken = client
            .call(
                "updates.take",
                None,
                CommandId::new(),
                json!({ "version": version }),
            )
            .await?;
        println!("{taken}");
    }
    if asked.now {
        let mut force = asked.force;
        if !force {
            let working = control::working(&mut client).await?;
            if working > 0 {
                if !control::agreed(working, control::Ending::Restart)? {
                    return Err(Failure::Broken("Nothing was restarted.".into()));
                }
                force = true;
            }
        }
        let moving = client
            .call(
                "updates.restart",
                None,
                CommandId::new(),
                json!({ "force": force }),
            )
            .await?;
        println!("{moving}");
    }
    if acts {
        return Ok(());
    }
    let follow = asked.follow;
    let stream = client.stream("updates.state").await?;
    loop {
        match client.heard().await? {
            banda_kernel::api::EngineFrame::Piece { stream: of, data } if of == stream => {
                println!("{data}");
                if !follow {
                    return Ok(());
                }
            }
            banda_kernel::api::EngineFrame::Result {
                id,
                error: Some(refusal),
                ..
            } if id == stream => return Err(Failure::Refused(refusal)),
            banda_kernel::api::EngineFrame::Ended { stream: of } if of == stream => {
                return Ok(());
            }
            _ => {}
        }
    }
}

/// `banda machine`: what the engine said, as it said welcome, its machine
/// is called and drawn by. An Agent's `banda` hears it too.
async fn machine(places: &Places, json: bool) -> Result<(), Failure> {
    let client = Client::connect(places).await?;
    let Some(named) = client.named() else {
        return Err(Failure::broken(
            "This engine names its machine nothing: it is older than this banda.",
        ));
    };
    let said = json!(named);
    if json {
        println!("{said}");
    } else {
        let icon = said["icon"].as_str().unwrap_or_default();
        println!("{}\t{icon}", named.name);
    }
    Ok(())
}

/// `banda modules`: what each module offers, no engine: Banda's own, then
/// the Apps installed from a folder, which hold no unstable mark.
fn print_modules(unstable: bool) -> ExitCode {
    let mut offers = modules::offers();
    if !unstable && let Ok(places) = Places::from_env() {
        offers.extend(modules::installed(&places.installed()));
    }
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

/// The look's places, in this Banda's config folder.
fn look_places() -> Result<banda_look::Places, Failure> {
    Places::from_env().map(|places| banda_look::Places {
        // What the window writes of the system, for the theme (ADR 0100,
        // decision 1).
        device: Some(places.state.join("device.json")),
        ..banda_look::Places::from_env(places.config)
    })
}

/// Under an Agent's pass, a change to Banda's settings goes to the engine
/// that gave it, which writes it as this would, and refuses what only the
/// Person changes (ADR 0083): behind the fence, the files are read-only.
/// `None` with no pass, when this writes the files itself.
fn through_the_engine(method: &str, params: Value) -> Option<ExitCode> {
    let pass = match client::Pass::from_env() {
        Ok(Some(pass)) => pass,
        Ok(None) => return None,
        Err(failure) => return Some(failure.exit()),
    };
    let asked = async {
        let mut client = Client::connect_as(&pass).await?;
        client.call(method, None, CommandId::new(), params).await
    };
    let done = tokio::runtime::Runtime::new()
        .map_err(Failure::broken)
        .and_then(|runtime| runtime.block_on(asked));
    Some(match done {
        Ok(said) => {
            if let Some(said) = said.as_str() {
                println!("{said}");
            }
            ExitCode::SUCCESS
        }
        Err(failure) => failure.exit(),
    })
}

/// `banda settings`: no engine, only the files (ADR 0016); but a change
/// under an Agent's pass, which its engine makes.
fn settings(what: SettingsCommand) -> ExitCode {
    let asked = match &what {
        SettingsCommand::Set { file, key, value } => Some((
            "keys.settings_set",
            json!({ "file": file, "key": key, "value": value }),
        )),
        SettingsCommand::Reset { file, key } => {
            Some(("keys.settings_reset", json!({ "file": file, "key": key })))
        }
        SettingsCommand::Rename { file, key, to } => Some((
            "keys.settings_rename",
            json!({ "file": file, "key": key, "to": to }),
        )),
        _ => None,
    };
    if let Some(done) = asked.and_then(|(method, params)| through_the_engine(method, params)) {
        return done;
    }
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

/// `banda keys`: no engine, only the files, as `banda settings`; but a
/// change under an Agent's pass, which its engine makes.
fn keys(what: Option<KeysCommand>, json: bool) -> ExitCode {
    use banda_keys::{Bind, Key, SetMod};
    let asked = match &what {
        Some(KeysCommand::Bind {
            key,
            action,
            args,
            scope,
        }) => Some((
            "keys.bind",
            json!({ "key": key, "action": action, "args": args, "scope": scope }),
        )),
        Some(KeysCommand::Free { key, scope }) => {
            Some(("keys.free", json!({ "key": key, "scope": scope })))
        }
        Some(KeysCommand::Reset { key, scope }) => {
            Some(("keys.reset", json!({ "key": key, "scope": scope })))
        }
        Some(KeysCommand::Mod { keys }) => Some(("keys.set_mod", json!({ "keys": keys }))),
        None => None,
    };
    if let Some(done) = asked.and_then(|(method, params)| through_the_engine(method, params)) {
        return done;
    }
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
/// `*`, its scope, its title and its owner.
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
        "{}\t{}{scope}\t{}\t{}",
        action.id,
        keys.join(", "),
        action.title,
        action.owner
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
    use banda_look::Hyprland;
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
