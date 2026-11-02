//! `banda mcp`: how an Agent in a Thread reaches Banda (ADR 0019). The
//! agents module hands it to every session it opens, as a stdio MCP
//! server, with two variables:
//!
//! - `BANDA_TOKEN`: the session's pass. The engine knows from it which
//!   Thread's Agent calls, and keeps it in that Thread's Space: a call
//!   names no Space, and runs there.
//! - `BANDA_ENGINE`: where the engine's API listens.
//!
//! It is a pipe: MCP on stdio, one JSON-RPC message per line, and the
//! engine's API on the other side. Its tools are the engine's
//! (`spaces.tools`, from the methods marked `tool`), read once as it
//! connects, and `skill`, which it answers itself from the Banda skill, as
//! `banda skill` does.
//!
//! A refused or malformed call is the tool's answer, marked as an error,
//! with what was wrong and that nothing was done. Only an engine that does
//! not answer is an error of the protocol.

use crate::Failure;
use crate::client::Client;
use banda_kernel::{CommandId, Refusal, Tool};
use banda_skill::Reach;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// The MCP versions it speaks, the newest first. Their messages are the
/// same for what it does.
const VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/// The version it answers a client that asks for one it does not speak.
const VERSION: &str = "2025-06-18";

const PARSE_ERROR: i64 = -32700;
const NO_METHOD: i64 = -32601;
const INTERNAL: i64 = -32603;

/// A JSON-RPC error: its code and its words.
type Error = (i64, String);

struct Mcp {
    engine: String,
    token: String,
    connected: Option<Connected>,
}

/// The engine, and the tools it had as `banda mcp` connected.
struct Connected {
    client: Client,
    tools: Vec<Tool>,
}

/// Answers MCP on stdin and stdout until stdin closes.
pub async fn serve() -> Result<(), Failure> {
    let variable = |name: &str| {
        std::env::var(name).map_err(|_| {
            Failure::broken(format!(
                "banda mcp needs {name}: the agents module sets it for a Thread's session."
            ))
        })
    };
    let mut mcp = Mcp {
        engine: variable("BANDA_ENGINE")?,
        token: variable("BANDA_TOKEN")?,
        connected: None,
    };
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut out = tokio::io::stdout();
    while let Some(line) = lines.next_line().await.map_err(Failure::broken)? {
        if line.trim().is_empty() {
            continue;
        }
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(message) => mcp.answer(message).await,
            Err(error) => Some(reply(Value::Null, Err((PARSE_ERROR, error.to_string())))),
        };
        if let Some(answer) = answer {
            out.write_all(format!("{answer}\n").as_bytes())
                .await
                .map_err(Failure::broken)?;
            out.flush().await.map_err(Failure::broken)?;
        }
    }
    Ok(())
}

fn reply(id: Value, answer: Result<Value, Error>) -> Value {
    match answer {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
        }
    }
}

/// An engine that does not answer, as JSON-RPC says it.
fn lost(failure: Failure) -> Error {
    (INTERNAL, failure.words())
}

impl Mcp {
    /// The answer to one message; none to a notification, nor to an
    /// answer, since it asks the client nothing.
    async fn answer(&mut self, message: Value) -> Option<Value> {
        let method = message.get("method")?.as_str()?.to_owned();
        let id = message.get("id")?.clone();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let answer = match method.as_str() {
            "initialize" => Ok(initialize(&params)),
            "ping" => Ok(json!({})),
            "tools/list" => self.tools().await.map(|tools| json!({ "tools": tools })),
            "tools/call" => self.call(&params).await,
            _ => Err((NO_METHOD, format!("banda mcp has no method {method}."))),
        };
        Some(reply(id, answer))
    }

    /// The engine, connected now if it was not, with its tools.
    async fn connected(&mut self) -> Result<&mut Connected, Failure> {
        let connected = match self.connected.take() {
            Some(connected) => connected,
            None => {
                let mut client = Client::connect_to(&self.engine, self.token.clone()).await?;
                let tools = client
                    .ask("spaces.tools", None, CommandId::new(), Value::Null)
                    .await?;
                let tools = serde_json::from_value(tools).map_err(Failure::broken)?;
                Connected { client, tools }
            }
        };
        Ok(self.connected.insert(connected))
    }

    /// The engine's tools and `skill`, as MCP lists them.
    async fn tools(&mut self) -> Result<Vec<Value>, Error> {
        let tools = &self.connected().await.map_err(lost)?.tools;
        let listed = tools.iter().map(|tool| {
            json!({ "name": tool.name, "description": tool.description, "inputSchema": tool.schema })
        });
        Ok(listed.chain([skill_tool()]).collect())
    }

    /// Runs one tool in the Space of the pass.
    async fn call(&mut self, params: &Value) -> Result<Value, Error> {
        let name = params["name"].as_str().unwrap_or_default();
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
        if name == "skill" {
            return Ok(skill(&arguments));
        }
        let connected = self.connected().await.map_err(lost)?;
        let Some(tool) = connected.tools.iter().find(|tool| tool.name == name) else {
            return Ok(said(
                format!("Banda has no tool \"{name}\". Nothing was done."),
                true,
            ));
        };
        let method = tool.method.clone();
        match connected
            .client
            .ask(&method, None, CommandId::new(), arguments)
            .await
        {
            // A text, as a page's tree, is said as it is.
            Ok(Value::String(text)) => Ok(said(text, false)),
            Ok(answer) => Ok(said(answer.to_string(), false)),
            Err(Failure::Refused(refusal)) => Ok(refused(&refusal)),
            Err(broken) => {
                // The next call connects again.
                self.connected = None;
                Err(lost(broken))
            }
        }
    }
}

fn initialize(params: &Value) -> Value {
    let asked = params["protocolVersion"].as_str();
    let version = asked.filter(|v| VERSIONS.contains(v)).unwrap_or(VERSION);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "banda", "version": env!("BANDA_VERSION") },
        "instructions": banda_skill::core(Reach::Tool),
    })
}

/// A tool's answer: one text.
fn said(text: String, error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": error })
}

fn refused(refusal: &Refusal) -> Value {
    // One that may have run, as a window that answered late, says so
    // itself: it ends in "may have been done."
    let nothing = if refusal.message.ends_with("may have been done.") {
        ""
    } else {
        " Nothing was done."
    };
    let text = format!("Refused ({}): {}{nothing}", refusal.code, refusal.message);
    said(text, true)
}

fn skill_tool() -> Value {
    json!({
        "name": "skill",
        "description": "A topic of the Banda skill: how to work in Banda and change it \
            for the Person. With no topic, the skill's core, which lists the topics.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "topic": { "type": "string", "description": "The topic's name, as the list says it." }
            },
        },
    })
}

fn skill(arguments: &Value) -> Value {
    match banda_skill::read(arguments["topic"].as_str(), Reach::Tool) {
        Ok(text) => said(text, false),
        Err(words) => said(format!("{words}\nNothing was done."), true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_answers_the_version_a_client_asks_for_if_it_speaks_it() {
        let asked =
            |v: &str| initialize(&json!({ "protocolVersion": v }))["protocolVersion"].clone();
        assert_eq!(asked("2025-03-26"), "2025-03-26");
        assert_eq!(asked("1999-01-01"), VERSION);
        assert_eq!(initialize(&Value::Null)["protocolVersion"], VERSION);
    }
}
