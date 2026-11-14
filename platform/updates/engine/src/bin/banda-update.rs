//! `banda-update`: Banda's updater as a program of its own (ADR 0131,
//! decision 2). It looks at the channel's releases, downloads the newest
//! engine, checks it and puts it beside the running one, in the data
//! folder's `engine/`. It decides and changes nothing else: the engine
//! asks it, and moves onto what it put there.
//!
//! ```text
//! banda-update check --running <v> --channel <c> --folder <f> --engine <dir> [--program <p>] [--takes <t>]
//! banda-update take <version|newest> (the same options)
//! banda-update run --channel <c> --folder <f> --engine <dir> --state <dir> --config <dir>
//! ```
//!
//! `run` is the updater's service, beside the engine's (`daemon.rs`): it
//! runs until it is stopped.
//!
//! It prints what the updates are as one line of JSON (`UpdateState`) at
//! each change, the last one when it is done, and exits 0; 2 when its
//! arguments are wrong. Two never take at once: one waits for the other
//! on `<engine>/.update.lock`.

use banda_machines::TakeUpdates;
use banda_updates::{Banda, UpdateState, Updates};
use clap::{Parser, Subcommand};
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;
use tokio::sync::watch;

#[derive(Parser)]
#[command(name = "banda-update", version = env!("BANDA_VERSION"), about = "Banda's updater")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Looks at the channel now, and takes the newest engine when it is
    /// newer than the one running and the one ready.
    Check(Of),
    /// Puts `version` in place, an older one too, and keeps it as chosen;
    /// `newest` drops the choice and looks again.
    Take {
        version: String,
        #[command(flatten)]
        of: Of,
    },
    /// The updater's service: it looks every hour, and puts back a copy
    /// the engine moved onto that does not start.
    Run(Serving),
}

/// The Banda `run` serves.
#[derive(clap::Args)]
struct Serving {
    #[arg(long)]
    channel: String,
    #[arg(long)]
    folder: String,
    /// Its data folder's `engine/`.
    #[arg(long)]
    engine: PathBuf,
    /// Its state folder, where `engine.json` is.
    #[arg(long)]
    state: PathBuf,
    /// Its config folder, where `machine.toml` is.
    #[arg(long)]
    config: PathBuf,
    #[arg(long, hide = true)]
    releases: Option<String>,
    /// Seconds before its first look: for the tests.
    #[arg(long, hide = true)]
    first_look: Option<u64>,
}

/// The Banda it updates.
#[derive(clap::Args)]
struct Of {
    /// The version its engine runs.
    #[arg(long)]
    running: String,
    /// `stable`, `dev` or `local`.
    #[arg(long)]
    channel: String,
    /// Its folder's name: `banda`, `banda-dev`, `banda-local`.
    #[arg(long)]
    folder: String,
    /// Where its copies of the engine are: the data folder's `engine/`.
    #[arg(long)]
    engine: PathBuf,
    /// The program its engine runs from.
    #[arg(long)]
    program: Option<PathBuf>,
    /// What machine.toml's `updates` says.
    #[arg(long, default_value = "when-idle")]
    takes: String,
    /// Where it reads releases, in place of GitHub's: for the tests.
    #[arg(long, hide = true)]
    releases: Option<String>,
}

impl Of {
    fn updates(self) -> Result<Updates, String> {
        let channel = channel_of(&self.channel)?;
        let folder: &'static str = Box::leak(self.folder.into_boxed_str());
        let takes: TakeUpdates = serde_json::from_value(self.takes.clone().into())
            .map_err(|_| format!("--takes is when-idle, ask or off, not {}", self.takes))?;
        let banda = Banda {
            channel,
            folder,
            version: self.running,
            program: self.program,
            engine: self.engine,
        };
        // The engine reads machine.toml, and says it here.
        let (_, take) = watch::channel(takes);
        let updates = Updates::new(banda, take);
        Ok(match self.releases {
            Some(at) => updates.reading(&at, Duration::MAX, Duration::MAX),
            None => updates,
        })
    }
}

/// A channel's name as the library takes it.
fn channel_of(said: &str) -> Result<&'static str, String> {
    match said {
        "stable" => Ok("stable"),
        "dev" => Ok("dev"),
        "local" => Ok("local"),
        other => Err(format!("--channel is stable, dev or local, not {other}")),
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let (of, version) = match cli.command {
        Command::Check(of) => (of, None),
        Command::Take { version, of } => (of, Some(version)),
        Command::Run(serving) => return serve(serving),
    };
    let engine = of.engine.clone();
    let updates = match of.updates() {
        Ok(updates) => updates,
        Err(why) => {
            eprintln!("banda-update: {why}");
            return ExitCode::from(2);
        }
    };
    let Ok(runtime) = tokio::runtime::Runtime::new() else {
        eprintln!("banda-update: no runtime");
        return ExitCode::FAILURE;
    };
    runtime.block_on(async move {
        let _one = banda_updates::guard::lock(&engine);
        let mut changes = updates.watch();
        let said = tokio::spawn(async move {
            while changes.changed().await.is_ok() {
                say(&changes.borrow_and_update().clone());
            }
        });
        let last = match version {
            None => updates.look().await,
            Some(version) => match updates.choose(&version).await {
                Ok(state) => state,
                Err(refusal) => UpdateState {
                    failed: Some(refusal.message),
                    ..updates.watch().borrow().clone()
                },
            },
        };
        said.abort();
        say(&last);
        banda_updates::guard::keep_state(&engine, &last);
    });
    ExitCode::SUCCESS
}

/// `run`: until it is stopped.
fn serve(serving: Serving) -> ExitCode {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();
    let channel = match channel_of(&serving.channel) {
        Ok(channel) => channel,
        Err(why) => {
            eprintln!("banda-update: {why}");
            return ExitCode::from(2);
        }
    };
    let Ok(runtime) = tokio::runtime::Runtime::new() else {
        eprintln!("banda-update: no runtime");
        return ExitCode::FAILURE;
    };
    runtime.block_on(banda_updates::daemon::run(banda_updates::daemon::Serves {
        channel,
        folder: Box::leak(serving.folder.into_boxed_str()),
        engine: serving.engine,
        state: serving.state,
        config: serving.config,
        releases: serving.releases,
        first: serving
            .first_look
            .map_or(banda_updates::daemon::FIRST_LOOK, Duration::from_secs),
    }));
    ExitCode::SUCCESS
}

/// One line of JSON on stdout.
fn say(state: &UpdateState) {
    if let Ok(line) = serde_json::to_string(state) {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}
