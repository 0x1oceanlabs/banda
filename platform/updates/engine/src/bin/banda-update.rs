//! `banda-update`: Banda's updater as a program of its own (ADR 0131,
//! decision 2). It looks at the channel's releases, downloads the newest
//! engine, checks it and puts it beside the running one, in the data
//! folder's `engine/`. It decides and changes nothing else: the engine
//! asks it, and moves onto what it put there.
//!
//! ```text
//! banda-update check --running <v> --channel <c> --folder <f> --engine <dir> [--program <p>] [--takes <t>]
//! banda-update take <version|newest> (the same options)
//! ```
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
        let channel = match self.channel.as_str() {
            "stable" => "stable",
            "dev" => "dev",
            "local" => "local",
            other => return Err(format!("--channel is stable, dev or local, not {other}")),
        };
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

fn main() -> ExitCode {
    let cli = Cli::parse();
    let (of, version) = match cli.command {
        Command::Check(of) => (of, None),
        Command::Take { version, of } => (of, Some(version)),
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
        let _one = locked(&engine);
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
    });
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

/// Waits for any other `banda-update` on `engine` to finish, and holds it
/// until this one does.
fn locked(engine: &std::path::Path) -> Option<std::fs::File> {
    std::fs::create_dir_all(engine).ok()?;
    let file = std::fs::File::create(engine.join(".update.lock")).ok()?;
    file.lock().ok()?;
    Some(file)
}
