//! The CLI's side of the API: it connects as the window does, so people,
//! scripts and Agents can do whatever the window can (ADR 0001, decision 1).
//!
//! An Agent's `banda` acts under its pass. The agents module hands a
//! Thread's Agent its pass and where the engine listens, in `BANDA_TOKEN`
//! and `BANDA_ENGINE`, for `banda mcp` and for the shell it runs commands
//! in (ADR 0019). Where both are set, every command that connects to the
//! engine says hello with that pass at that address, and works only in the
//! pass's Project; anywhere else it says hello as the owner.

use crate::Failure;
use crate::places::Places;
use banda_kernel::api::{ClientFrame, EngineFrame};
use banda_kernel::{Code, CommandId, Event, EventFilter, PROTOCOL, ProjectId, Refusal};
use futures::{SinkExt, StreamExt};
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// The variable that holds an Agent's pass.
pub const TOKEN: &str = "BANDA_TOKEN";
/// The variable that says where the engine that gave the pass listens.
pub const ENGINE: &str = "BANDA_ENGINE";

/// An Agent's pass, and where the engine that gave it listens.
#[derive(Debug, PartialEq, Eq)]
pub struct Pass {
    pub engine: String,
    pub token: String,
}

impl Pass {
    /// The pass this program's environment hands it, if it hands one.
    pub fn from_env() -> Option<Pass> {
        Pass::named(|name| std::env::var(name).ok())
    }

    /// The pass the variables name: both set, and neither empty.
    fn named(variable: impl Fn(&str) -> Option<String>) -> Option<Pass> {
        let set = |name| variable(name).filter(|value| !value.is_empty());
        Some(Pass {
            engine: set(ENGINE)?,
            token: set(TOKEN)?,
        })
    }
}

pub struct Client {
    socket: Socket,
    next_id: u64,
}

impl Client {
    /// Connects to this machine's engine: under the pass the environment
    /// hands this program, when it hands one, else as the owner.
    pub async fn connect(places: &Places) -> Result<Client, Failure> {
        if let Some(pass) = Pass::from_env() {
            return Client::connect_as(&pass).await;
        }
        let running = places.running()?;
        let nowhere = "Banda's engine does not answer. Start it with: banda serve";
        Client::hello(&running.url(), running.secret, nowhere).await
    }

    /// Connects to the engine the pass names, and says hello with it. The
    /// refusal of a pass the engine does not know says so.
    pub async fn connect_as(pass: &Pass) -> Result<Client, Failure> {
        let nowhere = format!(
            "Banda's engine does not answer at {}, where {ENGINE} says it listens.",
            pass.engine
        );
        let said = Client::hello(&pass.engine, pass.token.clone(), &nowhere).await;
        said.map_err(|failure| match failure {
            Failure::Refused(refusal) if refusal.code == Code::Forbidden => {
                Failure::Refused(Refusal::forbidden(format!(
                    "The engine at {} does not know the pass in {TOKEN}. A pass lasts \
                     while the engine that gave it runs, and a Thread's session gets a \
                     new one each time it opens. Nothing was done.",
                    pass.engine
                )))
            }
            other => other,
        })
    }

    /// Connects to the engine at `url` and says hello with `token`: the
    /// owner's secret, or an Agent's pass. `nowhere` says that no engine
    /// answers there.
    async fn hello(url: &str, token: String, nowhere: &str) -> Result<Client, Failure> {
        let (socket, _) = tokio_tungstenite::connect_async(url)
            .await
            .map_err(|_| Failure::broken(nowhere))?;
        let mut client = Client { socket, next_id: 1 };
        client
            .send(&ClientFrame::Hello {
                protocol: PROTOCOL,
                token,
            })
            .await?;
        match client.receive().await? {
            EngineFrame::Welcome { .. } => Ok(client),
            EngineFrame::Goodbye { reason } => Err(Failure::Refused(reason)),
            _ => Err(Failure::broken("The engine did not say welcome.")),
        }
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    async fn send(&mut self, frame: &ClientFrame) -> Result<(), Failure> {
        let text = serde_json::to_string(frame).map_err(Failure::broken)?;
        self.socket
            .send(Message::text(text))
            .await
            .map_err(Failure::broken)
    }

    async fn receive(&mut self) -> Result<EngineFrame, Failure> {
        loop {
            match self.socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    return serde_json::from_str(&text).map_err(Failure::broken);
                }
                Some(Ok(Message::Close(_))) | None => {
                    return Err(Failure::broken("The engine closed the connection."));
                }
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(Failure::broken(error)),
            }
        }
    }

    /// Calls one method. A command runs once per `command`, so a call that
    /// broke off can be repeated safely with the same ID; the failure says
    /// which.
    pub async fn call(
        &mut self,
        method: &str,
        project: Option<ProjectId>,
        command: CommandId,
        params: Value,
    ) -> Result<Value, Failure> {
        self.ask(method, project, command, params)
            .await
            .map_err(|failure| failure.cut_short(command))
    }

    /// Calls one method, and says nothing of how to repeat it.
    pub async fn ask(
        &mut self,
        method: &str,
        project: Option<ProjectId>,
        command: CommandId,
        params: Value,
    ) -> Result<Value, Failure> {
        let id = self.next_id();
        self.send(&ClientFrame::Call {
            id,
            method: method.to_owned(),
            project,
            command: Some(command),
            params,
        })
        .await?;
        loop {
            if let EngineFrame::Result {
                id: answered,
                ok,
                error,
            } = self.receive().await?
                && answered == id
            {
                return match error {
                    Some(refusal) => Err(Failure::Refused(refusal)),
                    None => Ok(ok.unwrap_or(Value::Null)),
                };
            }
        }
    }

    /// Hands each event of `project` after `after` to `each`, until the
    /// engine closes the connection.
    pub async fn follow(
        &mut self,
        project: ProjectId,
        after: i64,
        filter: EventFilter,
        mut each: impl FnMut(&Event),
    ) -> Result<(), Failure> {
        let id = self.next_id();
        self.send(&ClientFrame::Subscribe {
            id,
            project,
            after,
            filter,
        })
        .await?;
        let mut last = after;
        loop {
            match self.receive().await? {
                EngineFrame::Result {
                    id: answered,
                    error: Some(refusal),
                    ..
                } if answered == id => return Err(Failure::Refused(refusal)),
                EngineFrame::Event { event, .. } => {
                    last = event.seq;
                    each(&event);
                }
                EngineFrame::Resync { .. } => {
                    return Err(Failure::broken(format!(
                        "The engine could not go on. Follow again with --after {last}."
                    )));
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn named(variables: &[(&str, &str)]) -> Option<Pass> {
        let variables: HashMap<&str, &str> = variables.iter().copied().collect();
        Pass::named(|name| variables.get(name).map(|value| (*value).to_owned()))
    }

    #[test]
    fn a_pass_is_both_variables_set() {
        let engine = "ws://127.0.0.1:4000/ws";
        assert_eq!(
            named(&[(TOKEN, "f00d"), (ENGINE, engine)]),
            Some(Pass {
                engine: engine.to_owned(),
                token: "f00d".to_owned()
            })
        );
        assert_eq!(named(&[(TOKEN, "f00d")]), None, "the owner's, as before");
        assert_eq!(named(&[(ENGINE, engine)]), None);
        assert_eq!(named(&[(TOKEN, ""), (ENGINE, engine)]), None);
        assert_eq!(named(&[(TOKEN, "f00d"), (ENGINE, "")]), None);
        assert_eq!(named(&[]), None);
    }
}
