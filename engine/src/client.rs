//! The CLI's side of the API: it connects as the window does, so people,
//! scripts and Agents can do whatever the window can (ADR 0001, decision 1).

use crate::Failure;
use crate::places::Places;
use banda_kernel::api::{ClientFrame, EngineFrame};
use banda_kernel::{CommandId, Event, EventFilter, PROTOCOL, ProjectId};
use futures::{SinkExt, StreamExt};
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

pub struct Client {
    socket: Socket,
    next_id: u64,
}

impl Client {
    /// Connects to this machine's engine and says hello as its owner.
    pub async fn connect(places: &Places) -> Result<Client, Failure> {
        let running = places.running()?;
        Client::connect_to(&running.url(), running.secret).await
    }

    /// Connects to the engine at `url` and says hello with `token`: the
    /// owner's secret, or an Agent's pass.
    pub async fn connect_to(url: &str, token: String) -> Result<Client, Failure> {
        let (socket, _) = tokio_tungstenite::connect_async(url).await.map_err(|_| {
            Failure::broken("Banda's engine does not answer. Start it with: banda serve")
        })?;
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
