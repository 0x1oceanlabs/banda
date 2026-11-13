//! `banda app`: the Apps installed on this machine from a folder, which a
//! Person's Agent writes (ADR 0126, decision 5). Each is one call to the
//! engine's apps module, under whoever calls: an Agent's pass installs
//! from its own Project's folder. stdout holds only the result, as JSON.

use crate::Failure;
use crate::client::Client;
use crate::places::Places;
use banda_kernel::CommandId;
use clap::Subcommand;
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum AppCommand {
    /// Installs the App in FOLDER on this machine, or installs it again
    /// after a change: checks its app.toml, methods.json, migrations and
    /// entry, says what is wrong in them, and copies the folder into
    /// Banda's data. It runs from the engine's next start.
    Install {
        /// The App's folder; where this runs when left out.
        #[arg(default_value = ".")]
        folder: PathBuf,
    },
    /// Lists the Apps installed from a folder, one JSON object per line:
    /// each with its version, where it came from, and whether the engine
    /// runs that version yet.
    List,
    /// Removes an installed App. What it kept in each Project stays.
    Remove {
        /// Its id, as `clients`.
        id: String,
    },
}

/// `banda app`: one call to the apps module, and its answer.
pub async fn app(places: &Places, what: AppCommand) -> Result<(), Failure> {
    let mut client = Client::connect(places).await?;
    let mut call = async |method: &str, params: Value| {
        client.call(method, None, CommandId::new(), params).await
    };
    match what {
        AppCommand::Install { folder } => {
            let folder = std::path::absolute(&folder).map_err(Failure::broken)?;
            let installed = call("apps.install", json!({ "folder": folder })).await?;
            println!("{installed}");
        }
        AppCommand::List => {
            let listed = call("apps.installed", json!({})).await?;
            for app in listed.as_array().into_iter().flatten() {
                println!("{app}");
            }
        }
        AppCommand::Remove { id } => {
            call("apps.remove", json!({ "id": id })).await?;
        }
    }
    Ok(())
}
