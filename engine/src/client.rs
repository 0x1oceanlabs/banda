//! The CLI's side of the API: it connects as the window does, so people,
//! scripts and Agents can do whatever the window can (ADR 0001, decision 1).
//!
//! An Agent's `banda` acts under its pass. The agents module hands an
//! Agent its pass, and where the engine that gave it listens, in
//! `BANDA_TOKEN` and `BANDA_ENGINE`: to its `banda mcp`, and to the shell
//! it runs commands in (ADR 0019). With `BANDA_ENGINE` set, every command
//! that connects to the engine says hello there with that pass, and works
//! only in the pass's Project. It does nothing without a pass, nor when
//! `BANDA_STATE` names another engine. With no `BANDA_ENGINE`, it says
//! hello as the owner.

use crate::Failure;
use crate::places::{self, Places};
use banda_kernel::api::{ClientFrame, EngineFrame};
use banda_kernel::{
    Code, CommandId, ENGINE_VARIABLE, Event, EventFilter, PROTOCOL, ProjectId, Refusal,
    TOKEN_VARIABLE,
};
use futures::{SinkExt, StreamExt};
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// An Agent's pass, and where the engine that gave it listens.
pub struct Pass {
    pub engine: String,
    pub token: String,
}

impl Pass {
    /// The pass this program's environment hands it: none without
    /// `BANDA_ENGINE`, and a refusal when that names an engine but
    /// `BANDA_TOKEN` holds no pass for it.
    pub fn from_env() -> Result<Option<Pass>, Failure> {
        let set = |name| std::env::var(name).ok().filter(|value| !value.is_empty());
        let Some(engine) = set(ENGINE_VARIABLE) else {
            return Ok(None);
        };
        let Some(token) = set(TOKEN_VARIABLE) else {
            return Err(Failure::Refused(Refusal::forbidden(format!(
                "{ENGINE_VARIABLE} names the engine at {engine}, but {TOKEN_VARIABLE} \
                 holds no pass for it: the Harness may keep it out of its shells. \
                 Nothing was done."
            ))));
        };
        Ok(Some(Pass { engine, token }))
    }

    /// A `BANDA_STATE` that names a place must name the pass's engine
    /// there: a call meant for another engine, such as a trial's, is
    /// refused rather than made under this pass.
    fn meant(&self, places: &Places) -> Result<(), Failure> {
        if !places::state_named() {
            return Ok(());
        }
        let there = places.running().ok().map(|running| running.url());
        if there.as_deref() == Some(self.engine.as_str()) {
            return Ok(());
        }
        Err(Failure::Refused(Refusal::invalid(format!(
            "BANDA_STATE names another engine than the one at {}, in {ENGINE_VARIABLE}, \
             which gave the pass in {TOKEN_VARIABLE}. Nothing was done.",
            self.engine
        ))))
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
        if let Some(pass) = Pass::from_env()? {
            pass.meant(places)?;
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
            "Banda's engine does not answer at {}, where {ENGINE_VARIABLE} says it listens.",
            pass.engine
        );
        let said = Client::hello(&pass.engine, pass.token.clone(), &nowhere).await;
        said.map_err(|failure| match failure {
            Failure::Refused(refusal) if refusal.code == Code::Forbidden => {
                Failure::Refused(Refusal::forbidden(format!(
                    "The engine at {} does not know the pass in {TOKEN_VARIABLE}: a pass \
                     lasts only while the engine that gave it runs. Nothing was done.",
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
