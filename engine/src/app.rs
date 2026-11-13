//! `banda app`: the Apps installed on this machine from a folder, which a
//! Person's Agent writes (ADR 0126, decision 5). `new` writes a folder to
//! start from and `check` reads one, with no engine. The rest are each
//! one call to the engine's apps module, under whoever calls: an Agent's
//! pass installs from its own Project's folder. stdout holds only the
//! result, as JSON.

use crate::Failure;
use crate::client::Client;
use crate::places::Places;
use banda_kernel::CommandId;
use clap::Subcommand;
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum AppCommand {
    /// Writes a new App named ID in the folder ID here: one table, one
    /// command and one call, whole as it is, to change into your own.
    New {
        /// Its id: lowercase letters, as `clients`.
        id: String,
    },
    /// Reads the App in FOLDER and says what is wrong in it, by file: its
    /// app.toml, methods.json and migrations, each step tried as a
    /// Project would run it. It installs nothing and runs none of its
    /// code.
    Check {
        /// The App's folder; where this runs when left out.
        #[arg(default_value = ".")]
        folder: PathBuf,
    },
    /// Installs the App in FOLDER on this machine, or installs it again
    /// after a change: checks its app.toml, methods.json, migrations and
    /// entry, says what is wrong in them, copies the folder into Banda's
    /// data and adds it to the running engine. It runs at once, in every
    /// Project; `off` names those where its tables did not come up to
    /// date, with why.
    Install {
        /// The App's folder; where this runs when left out.
        #[arg(default_value = ".")]
        folder: PathBuf,
    },
    /// Lists the Apps installed from a folder, one JSON object per line:
    /// each with its version, where it came from, and whether the engine
    /// serves that version.
    List,
    /// Removes an installed App. What it kept in each Project stays.
    Remove {
        /// Its id, as `clients`.
        id: String,
    },
}

/// `banda app`: what is written or read here, with no engine, or one call
/// to the apps module, and its answer.
pub async fn app(places: &Places, what: AppCommand) -> Result<(), Failure> {
    match what {
        AppCommand::New { id } => {
            let folder = std::path::absolute(&id).map_err(Failure::broken)?;
            banda_apps::new::write(&folder, &id).map_err(Failure::Refused)?;
            println!("{}", json!({ "folder": folder }));
        }
        AppCommand::Check { folder } => {
            let app = banda_apps::folder::Folder::check(&folder).map_err(Failure::Refused)?;
            let tools: Vec<_> = app.tools().into_iter().map(|tool| tool.name).collect();
            let read = json!({
                "id": app.id,
                "version": app.version,
                "tools": tools,
                "steps": app.migrations.len(),
            });
            println!("{read}");
        }
        AppCommand::Install { folder } => {
            let folder = std::path::absolute(&folder).map_err(Failure::broken)?;
            let installed = call(places, "apps.install", json!({ "folder": folder })).await?;
            println!("{installed}");
        }
        AppCommand::List => {
            let listed = call(places, "apps.installed", json!({})).await?;
            for app in listed.as_array().into_iter().flatten() {
                println!("{app}");
            }
        }
        AppCommand::Remove { id } => {
            call(places, "apps.remove", json!({ "id": id })).await?;
        }
    }
    Ok(())
}

/// One call to the engine's apps module, under whoever calls.
async fn call(places: &Places, method: &str, params: Value) -> Result<Value, Failure> {
    let mut client = Client::connect(places).await?;
    client.call(method, None, CommandId::new(), params).await
}
