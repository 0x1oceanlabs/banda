//! `banda act ID`: runs one of Banda's actions in the window where the
//! Person is, by its id, as its key does (ADR 0127, decision 2). The keys
//! module checks the id and the args and asks the window (`keys.act`);
//! under an Agent's pass it refuses what acts as the Person (ADR 0083,
//! decision 3), as it does for the Agent's `act` tool.

use crate::Failure;
use crate::client::Client;
use crate::places::Places;
use banda_kernel::CommandId;
use banda_look::keys::Args;
use serde_json::json;

/// Runs action `id` with `args`, and prints what the engine said.
pub async fn act(places: &Places, id: String, args: Option<Args>) -> Result<(), Failure> {
    let mut client = Client::connect(places).await?;
    let params = json!({ "action": id, "args": args });
    let said = (client.call("keys.act", None, CommandId::new(), params)).await?;
    println!("{}", json!({ "ok": said }));
    Ok(())
}
