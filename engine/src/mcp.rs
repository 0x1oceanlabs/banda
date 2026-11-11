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
//! Each tool call carries a command ID that comes from this session of
//! `banda mcp` and the request's ID (ADR 0082, decision 4). A tool whose
//! method is a command keeps a receipt under it: a request sent again, by
//! its client or by `banda mcp` as it connects again to an engine that
//! broke off, gets the first answer and runs nothing again. It is sent with
//! the same arguments, and the receipt keeps their hash: the same request
//! ID with other arguments or for another tool, which MCP forbids, is
//! refused as `conflict` and runs nothing. Any other tool, a `call`, keeps
//! no receipt, so `banda mcp` never sends it again: one the engine broke
//! off on is answered that it may have run. Each tool's kind comes with the
//! engine's tools, from its line in `methods!`. A session ends as `banda
//! mcp` does, or as its client says `initialize` again: the next numbers
//! its requests from one again, and they get other IDs.
//!
//! A resend comes within seven days of the first send. Today that is a
//! convention of Banda's clients, which `banda mcp` keeps by sending again
//! at once, within its session. The host will check it: a command will
//! carry `not_after`, and past it the host will refuse it (ADR 0082,
//! decisions 4 and 16).
//!
//! A refused or malformed call is the tool's answer, marked as an error,
//! with what was wrong and that nothing was done. Only an engine that does
//! not answer is an error of the protocol.

use crate::Failure;
use crate::client::{Client, Pass};
use banda_kernel::{
    Code, CommandId, ENGINE_VARIABLE, Kind, Picture, Refusal, TOKEN_VARIABLE, Tool,
};
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
    /// This session, new each time `banda mcp` starts and each time its
    /// client says `initialize`: what its tool calls' command IDs are
    /// derived from.
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
        session: new_session(),
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
            "initialize" => {
                self.session = new_session();
                Ok(initialize(&params))
            }
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
    /// `id` of this session makes. After the engine broke off, a tool whose
    /// method is a command is asked again, once, under the same ID, on a
    /// new connection: its receipt makes what ran before it broke off run
    /// nothing again. If the engine does not answer then either, how it
    /// broke off first is what is said. Any other tool keeps no receipt, so
    /// it is not sent again: its Agent is told that it may have run, and
    /// decides.
    async fn call(&mut self, id: &Value, params: &Value) -> Result<Value, Error> {
        let name = params["name"].as_str().unwrap_or_default();
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
        if name == "skill" {
            return Ok(skill(&arguments));
        }
        let tools = &self.connected().await.map_err(lost)?.tools;
        let Some(tool) = tools.iter().find(|tool| tool.name == name).cloned() else {
            let text = format!("Banda has no tool \"{name}\". Nothing was done.");
            return Ok(said(text, true));
        };
        let command = command_id(&self.session, id);
        let first = match self.ask(&tool.method, command, &arguments).await {
            Ok(answer) => return Ok(answer),
            Err(broke) => broke,
        };
        if tool.kind != Kind::Command {
            return Ok(cut_short(name, first));
        }
        (self.ask(&tool.method, command, &arguments).await).map_err(|_| lost(first))
    }

    /// Asks the engine once to run `method` as `command`: the tool's
    /// answer, a refusal among them, or how the engine did not answer,
    /// after which the next ask connects again.
    async fn ask(
        &mut self,
        method: &str,
        command: CommandId,
        arguments: &Value,
    ) -> Result<Value, Failure> {
        let connected = self.connected().await?;
        let asked = (connected.client)
            .ask(method, None, command, arguments.clone())
            .await;
        match asked {
            Ok(answer) => Ok(answered(answer)),
            Err(Failure::Refused(refusal)) => Ok(refused(&refusal)),
            Err(broken) => {
                self.connected = None;
                Err(broken)
            }
        }
    }
}

/// A session of `banda mcp`: its tool calls' commands are its own.
fn new_session() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// The command ID of request `id` in `session`. A JSON-RPC ID is a number
/// or a string, and `7` and `"7"` are two requests. Any other, such as
/// `null`, which MCP forbids, makes a command of its own each time. The ID
/// names the request, not what it asks: the kernel's receipt holds the
/// tool's method and a hash of its arguments, so a reused ID never gets
/// another call's answer.
fn command_id(session: &str, id: &Value) -> CommandId {
    let integer = id.as_i64().is_some() || id.as_u64().is_some();
    if integer || id.is_string() {
        CommandId::derive(session, &id.to_string())
    } else {
        CommandId::new()
    }
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

/// The answer to a tool call the engine broke off on, when its method is
/// not a command: with no receipt to answer a resend from, it was not sent
/// again, and its Agent looks before it asks again.
fn cut_short(name: &str, broke: Failure) -> Value {
    let text = format!(
        "{name} may have run: the connection to Banda broke before it \
         answered, and it was not sent again, as it keeps no receipt and a \
         second send could run it twice. Look before you call it again. \
         How it broke: {}",
        broke.words()
    );
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
    fn a_request_is_one_command_by_its_id_as_json_says_it() {
        let session = new_session();
        let seven = command_id(&session, &json!(7));
        assert_eq!(seven, command_id(&session, &json!(7)), "sent again");
        assert_ne!(seven, command_id(&session, &json!("7")));
        // An ID MCP forbids collapses no two requests into one command.
        let null = command_id(&session, &Value::Null);
        assert_ne!(null, command_id(&session, &Value::Null));
        assert_ne!(
            command_id(&session, &json!(7.5)),
            command_id(&session, &json!(7.5))
        );
    }

    /// An engine that lists three tools: `send`, a command; `act`, a
    /// `call`; and `old`, with no kind, as an older engine lists one. It
    /// takes one call to them on each connection, one after another: it
    /// answers it with what `answers` says, or breaks off the connection at
    /// `None`. No engine listens after the last. It hands back the command
    /// each call carried.
    async fn engine(
        answers: Vec<Option<Value>>,
    ) -> (Pass, tokio::task::JoinHandle<Vec<CommandId>>) {
        use banda_kernel::PROTOCOL;
        use banda_kernel::api::{ClientFrame, EngineFrame};
        use futures::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let engine = format!("ws://{}", listener.local_addr().unwrap());
        let served = tokio::spawn(async move {
            let (mut listener, last) = (Some(listener), answers.len());
            let mut commands = vec![];
            for (n, answer) in answers.into_iter().enumerate() {
                let (stream, _) = listener.as_ref().unwrap().accept().await.unwrap();
                if n + 1 == last {
                    listener = None;
                }
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                let say =
                    |frame: EngineFrame| Message::text(serde_json::to_string(&frame).unwrap());
                socket.next().await.unwrap().unwrap();
                let welcome = EngineFrame::Welcome {
                    protocol: PROTOCOL,
                    engine: "fake".into(),
                    modules: vec![],
                    machine: None,
                    boot: "a boot".into(),
                    fence: None,
                    named: None,
                    version: None,
                    build: None,
                };
                socket.send(say(welcome)).await.unwrap();
                while let Some(Ok(Message::Text(text))) = socket.next().await {
                    let Ok(ClientFrame::Call {
                        id,
                        method,
                        command,
                        ..
                    }) = serde_json::from_str(&text)
                    else {
                        continue;
                    };
                    if method == "projects.tools" {
                        let tools = json!([
                            { "name": "send", "method": "agents.send", "kind": "command", "description": "", "schema": {} },
                            { "name": "act", "method": "browser.act", "kind": "call", "description": "", "schema": {} },
                            { "name": "old", "method": "browser.old", "description": "", "schema": {} },
                        ]);
                        let listed = EngineFrame::Result {
                            id,
                            ok: Some(tools),
                            error: None,
                            at: None,
                        };
                        socket.send(say(listed)).await.unwrap();
                        continue;
                    }
                    commands.push(command.unwrap());
                    if let Some(ok) = answer {
                        let answered = EngineFrame::Result {
                            id,
                            ok: Some(ok),
                            error: None,
                            at: Some(1),
                        };
                        socket.send(say(answered)).await.unwrap();
                    }
                    break;
                }
            }
            commands
        });
        let pass = Pass {
            engine,
            token: "a pass".into(),
        };
        (pass, served)
    }

    fn mcp(pass: Pass) -> Mcp {
        Mcp {
            pass,
            session: new_session(),
            connected: None,
        }
    }

    #[tokio::test]
    async fn a_command_the_engine_broke_off_is_asked_again_once_under_the_same_id() {
        let (pass, served) = engine(vec![None, Some(json!("sent"))]).await;
        let mut mcp = mcp(pass);
        let call = json!({ "name": "send", "arguments": { "text": "hi" } });
        let answer = mcp.call(&json!(7), &call).await;
        assert_eq!(answer, Ok(said("sent".into(), false)));
        let command = command_id(&mcp.session, &json!(7));
        assert_eq!(served.await.unwrap(), [command, command]);
    }

    #[tokio::test]
    async fn an_engine_that_does_not_answer_again_is_told_by_how_it_broke_off() {
        let (pass, served) = engine(vec![None]).await;
        let mut mcp = mcp(pass);
        let call = json!({ "name": "send", "arguments": {} });
        let (code, words) = mcp.call(&json!(7), &call).await.unwrap_err();
        assert_eq!(code, INTERNAL);
        // Not that nothing listens now: the call may have run.
        assert!(!words.contains("does not answer"), "{words}");
        assert_eq!(served.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_tool_with_no_receipt_the_engine_broke_off_on_is_not_sent_again() {
        // A `call` keeps no receipt, and a tool with no kind counts as one.
        for name in ["act", "old"] {
            let (pass, served) = engine(vec![None]).await;
            let mut mcp = mcp(pass);
            let call = json!({ "name": name, "arguments": { "click": "Buy" } });
            let answer = mcp.call(&json!(7), &call).await.unwrap();
            assert_eq!(answer["isError"], true, "{answer}");
            let text = answer["content"][0]["text"].as_str().unwrap();
            assert!(text.starts_with(&format!("{name} may have run")), "{text}");
            assert!(text.contains("not sent again"), "{text}");
            assert!(text.contains("How it broke: "), "{text}");
            assert_eq!(served.await.unwrap().len(), 1, "{name} was sent once");
        }
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
