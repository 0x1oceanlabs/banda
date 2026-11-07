//! `banda mcp`: how an Agent in a Thread reaches Banda (ADR 0019). The
//! agents module hands it to every session it opens, as a stdio MCP
//! server, with two variables:
//!
//! - `BANDA_TOKEN`: the session's pass. The engine knows from it which
//!   Thread's Agent calls, and keeps it in that Thread's Project: a call
//!   names no Project, and runs there.
//! - `BANDA_ENGINE`: where the engine's API listens.
//!
//! It is a pipe: MCP on stdio, one JSON-RPC message per line, and the
//! engine's API on the other side. Its tools are the engine's
//! (`projects.tools`, from the methods marked `tool`), read once as it
//! connects, and `skill`, which it answers itself from the Banda skill, as
//! `banda skill` does.
//!
//! Each tool call is a command whose ID comes from this session of `banda
//! mcp` and the request's ID (ADR 0082, decision 4). A request sent again,
//! by its client or by `banda mcp` as it connects again to an engine that
//! broke off, gets the first answer and runs nothing again. Another
//! session, as its Harness starts `banda mcp` again, numbers its requests
//! from one again, and they get other IDs.
//!
//! A refused or malformed call is the tool's answer, marked as an error,
//! with what was wrong and that nothing was done. Only an engine that does
//! not answer is an error of the protocol.

use crate::Failure;
use crate::client::{Client, Pass};
use banda_kernel::{Code, CommandId, ENGINE_VARIABLE, Picture, Refusal, TOKEN_VARIABLE, Tool};
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
    pass: Pass,
    /// This session, new each time `banda mcp` starts: what its tool
    /// calls' command IDs are derived from.
    session: String,
    connected: Option<Connected>,
}

/// The engine, and the tools it had as `banda mcp` connected.
struct Connected {
    client: Client,
    tools: Vec<Tool>,
}

/// Answers MCP on stdin and stdout until stdin closes.
pub async fn serve() -> Result<(), Failure> {
    let pass = Pass::from_env().ok().flatten().ok_or_else(|| {
        Failure::broken(format!(
            "banda mcp needs {TOKEN_VARIABLE} and {ENGINE_VARIABLE}: the agents module sets them for a Thread's session."
        ))
    })?;
    let mut mcp = Mcp {
        pass,
        session: CommandId::new().to_string(),
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
            "tools/call" => self.call(&id, &params).await,
            _ => Err((NO_METHOD, format!("banda mcp has no method {method}."))),
        };
        Some(reply(id, answer))
    }

    /// The engine, connected now if it was not, with its tools.
    async fn connected(&mut self) -> Result<&mut Connected, Failure> {
        let connected = match self.connected.take() {
            Some(connected) => connected,
            None => {
                let mut client = Client::connect_as(&self.pass).await?;
                let tools = client
                    .ask("projects.tools", None, CommandId::new(), Value::Null)
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

    /// Runs one tool in the Project of the pass, as the command request
    /// `id` of this session makes. An engine that broke off is connected
    /// to again, once, and asked again under the same ID, so what ran
    /// before it broke off runs nothing again.
    async fn call(&mut self, id: &Value, params: &Value) -> Result<Value, Error> {
        let name = params["name"].as_str().unwrap_or_default();
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
        if name == "skill" {
            return Ok(skill(&arguments));
        }
        let command = command_id(&self.session, id);
        // How the engine broke off the first ask: what is answered when it
        // does not answer again.
        let mut broke: Option<Failure> = None;
        loop {
            let connected = match self.connected().await {
                Ok(connected) => connected,
                Err(failure) => return Err(lost(broke.unwrap_or(failure))),
            };
            let Some(tool) = connected.tools.iter().find(|tool| tool.name == name) else {
                return Ok(said(
                    format!("Banda has no tool \"{name}\". Nothing was done."),
                    true,
                ));
            };
            let method = tool.method.clone();
            let asked = connected
                .client
                .ask(&method, None, command, arguments.clone())
                .await;
            match asked {
                Ok(answer) => return Ok(answered(answer)),
                Err(Failure::Refused(refusal)) => return Ok(refused(&refusal)),
                Err(broken) => {
                    // The next ask connects again.
                    self.connected = None;
                    if let Some(first) = broke {
                        return Err(lost(first));
                    }
                    broke = Some(broken);
                }
            }
        }
    }
}

/// The command ID of request `id` in `session`. A JSON-RPC ID is a number
/// or a string, and `7` and `"7"` are two requests.
fn command_id(session: &str, id: &Value) -> CommandId {
    CommandId::derive(session, &id.to_string())
}

fn initialize(params: &Value) -> Value {
    let asked = params["protocolVersion"].as_str();
    let version = asked.filter(|v| VERSIONS.contains(v)).unwrap_or(VERSION);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "banda", "version": env!("BANDA_VERSION") },
        "instructions": banda_skill::brief(),
    })
}

/// What a tool answered, as MCP says it: a text, as a page's tree, as it
/// is; the `pictures` an answer holds as images, after the rest of it.
fn answered(answer: Value) -> Value {
    let mut answer = match answer {
        Value::String(text) => return said(text, false),
        answer => answer,
    };
    let pictures = answer
        .as_object_mut()
        .and_then(|fields| fields.remove("pictures"))
        .and_then(|pictures| serde_json::from_value::<Vec<Picture>>(pictures).ok())
        .unwrap_or_default();
    let mut content = vec![json!({ "type": "text", "text": answer.to_string() })];
    content.extend(
        pictures.into_iter().map(
            |picture| json!({ "type": "image", "data": picture.data, "mimeType": picture.mime }),
        ),
    );
    json!({ "content": content, "isError": false })
}

/// A tool's answer: one text.
fn said(text: String, error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": error })
}

fn refused(refusal: &Refusal) -> Value {
    // One that may have run, as a window that answered late, says so
    // itself.
    let nothing = if refusal.code == Code::MayHaveRun {
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
    fn an_answer_says_its_text_and_shows_its_pictures() {
        assert_eq!(answered(json!("- a tree")), said("- a tree".into(), false));
        assert_eq!(
            answered(json!({ "height": 3 })),
            said(r#"{"height":3}"#.into(), false)
        );
        let shown = answered(json!({
            "height": 3,
            "pictures": [{ "mime": "image/png", "data": "iVBO" }],
        }));
        assert_eq!(
            shown,
            json!({
                "content": [
                    { "type": "text", "text": r#"{"height":3}"# },
                    { "type": "image", "data": "iVBO", "mimeType": "image/png" },
                ],
                "isError": false,
            })
        );
    }

    #[test]
    fn a_request_is_one_command_in_its_session_and_only_there() {
        let session = CommandId::new().to_string();
        let seven = command_id(&session, &json!(7));
        assert_eq!(seven, command_id(&session, &json!(7)), "sent again");
        assert_ne!(seven, command_id(&session, &json!(8)));
        assert_ne!(seven, command_id(&session, &json!("7")));
        // A new `banda mcp` numbers its requests from one again.
        let next = CommandId::new().to_string();
        assert_ne!(seven, command_id(&next, &json!(7)));
    }

    #[test]
    fn it_answers_the_version_a_client_asks_for_if_it_speaks_it() {
        let asked =
            |v: &str| initialize(&json!({ "protocolVersion": v }))["protocolVersion"].clone();
        assert_eq!(asked("2025-03-26"), "2025-03-26");
        assert_eq!(asked("1999-01-01"), VERSION);
        assert_eq!(initialize(&Value::Null)["protocolVersion"], VERSION);
    }
}
