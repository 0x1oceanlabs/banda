//! `bandaso`: the engine and its CLI in one program.
//!
//! - `bandaso serve` runs this machine's engine.
//! - `bandaso call <method>` calls one API method and prints `{"ok": …}`.
//! - `bandaso follow --space <id>` prints the Space's events, one JSON
//!   object per line.
//! - `bandaso look` prints the window's look, resolved from Omarchy's
//!   theme, Hyprland and `~/.config/banda/look.toml`; `--follow` prints it
//!   again on each change. It needs no engine: the look is this machine's.
//!
//! When the engine refuses (the call, the hello or the follow), the CLI
//! prints `{"error": {"code", "message"}}` and exits 1. When no engine
//! answers, or the program cannot do its part, it says so on stderr and
//! exits 2.

mod client;
mod places;
mod serve;

use bandaso_kernel::{CommandId, EventFilter, Refusal, SpaceId};
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
    name = "bandaso",
    version,
    about = "Bandaso: a tiling workspace for working with Agents."
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
    /// theme, Hyprland's windows and ~/.config/banda/look.toml.
    Look {
        #[command(subcommand)]
        what: Option<LookCommand>,
        /// Prints it again, one JSON object per line, each time a file it
        /// reads changes or Hyprland reloads.
        #[arg(long)]
        follow: bool,
    },
}

#[derive(Subcommand)]
enum LookCommand {
    /// Checks look.toml, a theme's banda.toml or colors.toml, or with no
    /// files every file the look reads. Prints path:line:column: problem
    /// and exits 1 when anything is wrong; prints nothing when all is well.
    Check { files: Vec<PathBuf> },
    /// Lists the themes there are, one JSON object per line.
    Themes,
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
                eprintln!("bandaso: {words}");
                ExitCode::from(2)
            }
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    if let Command::Look { what, follow } = cli.command {
        return look(what, follow);
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("BANDASO_LOG")
                .unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let done = Places::from_env().and_then(|places| {
        let runtime = tokio::runtime::Runtime::new().map_err(Failure::broken)?;
        runtime.block_on(run(cli.command, places))
    });
    match done {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => failure.exit(),
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
            let answer = Client::connect(&places)
                .await?
                .call(&method, space, command.unwrap_or_default(), params)
                .await?;
            println!("{}", json!({ "ok": answer }));
            Ok(())
        }
        Command::Look { .. } => unreachable!("the look runs without the engine"),
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

/// `bandaso look`: no engine, no runtime, only files and Hyprland's socket.
fn look(what: Option<LookCommand>, follow: bool) -> ExitCode {
    use bandaso_look::hyprland::Hyprland;
    use bandaso_look::theme::Places;

    let places = Places::from_env();
    let mut out = std::io::stdout().lock();
    // A reader that went away is not an error: the window closed.
    let mut print =
        |value: serde_json::Value| writeln!(out, "{value}").and_then(|()| out.flush()).is_ok();
    match what {
        None if follow => {
            bandaso_look::follow(&places, Hyprland::from_env(), |look| print(json!(look)));
            ExitCode::SUCCESS
        }
        None => {
            let hyprland = Hyprland::from_env();
            let windows = || hyprland.as_ref().and_then(|h| h.windows().ok());
            print(json!(bandaso_look::resolve(&places, &windows).look));
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
        Some(LookCommand::Check { files }) => {
            let problems = if files.is_empty() {
                bandaso_look::resolve(&places, &|| None).look.problems
            } else {
                bandaso_look::check(&files)
            };
            for problem in &problems {
                eprintln!("{problem}");
            }
            if problems.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
    }
}
