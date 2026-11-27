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
//! hello as the owner. With `--host`, it goes to another machine's door,
//! as a device of its own there (`there.rs`).

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

/// What a connection's bytes go over: a socket of this machine, or the
/// pipes of an ssh that carries another machine's door (`there.rs`).
pub trait Pipe: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> Pipe for T {}

type Socket = tokio_tungstenite::WebSocketStream<Box<dyn Pipe>>;

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
    /// What the engine said of its fence as it said welcome; none from an
    /// engine from before the fence.
    fence: Option<banda_kernel::Fence>,
    /// What it said its machine is called and drawn by; none from an
    /// engine that names it nothing.
    named: Option<banda_kernel::Named>,
    /// The log its machine's modules are followed by; none while no module
    /// is.
    machine: Option<ProjectId>,
    /// The Apps it said it runs, with their versions.
    apps: Vec<banda_kernel::App>,
}

impl Client {
    /// Connects to this machine's engine: under the pass the environment
    /// hands this program, when it hands one, else as the owner, to the
    /// engine that runs or the one this starts (`control.rs`).
    pub async fn connect(places: &Places) -> Result<Client, Failure> {
        if let Some(machine) = crate::there::named() {
            return crate::there::connect(places, machine).await;
        }
        if let Some(pass) = Pass::from_env()? {
            pass.meant(places)?;
            return Client::connect_as(&pass).await;
        }
        crate::control::connect(places).await
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
                     lasts while its session does, and a while after an engine restart. \
                     Nothing was done.",
                    pass.engine
                )))
            }
            other => other,
        })
    }

    /// Connects to the engine at `url` and says hello with `token`: the
    /// owner's secret, or an Agent's pass. `nowhere` says that no engine
    /// answers there.
    pub(crate) async fn hello(url: &str, token: String, nowhere: &str) -> Result<Client, Failure> {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let nowhere = || Failure::broken(nowhere);
        let request = url.into_client_request().map_err(|_| nowhere())?;
        let at = request.uri().authority().ok_or_else(nowhere)?.as_str();
        let pipe = tokio::net::TcpStream::connect(at)
            .await
            .map_err(|_| nowhere())?;
        let pipe: Box<dyn Pipe> = Box::new(pipe);
        let (socket, _) = tokio_tungstenite::client_async(request, pipe)
            .await
            .map_err(|_| nowhere())?;
        let mut client = Client::over(socket);
        client
            .send(&ClientFrame::Hello {
                protocol: PROTOCOL,
                token,
            })
            .await?;
        client.welcomed().await.map(|_| client)
    }

    fn over(socket: Socket) -> Client {
        Client {
            socket,
            next_id: 1,
            fence: None,
            named: None,
            machine: None,
            apps: Vec::new(),
        }
    }

    /// Connects to another machine's door over `pipe`, and says hello as
    /// the device `kept` names, by `key` (ADR 0124, decision 3). The door
    /// must prove the host key kept, in its challenge and in its welcome,
    /// before and after this device says who it is. `nowhere` says that
    /// no door answers there.
    pub(crate) async fn at_door(
        pipe: Box<dyn Pipe>,
        kept: &crate::there::Kept,
        key: &ring::signature::Ed25519KeyPair,
        nowhere: &str,
    ) -> Result<Client, Failure> {
        use banda_kernel::devices::{
            DeviceFrame, DoorFrame, Protocols, challenge_message, hello_message, welcome_message,
        };
        use base64::Engine as _;
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use ring::rand::SecureRandom;
        use ring::signature::{ED25519, UnparsedPublicKey};
        let another = || {
            Failure::Refused(Refusal::forbidden(
                "The door there does not prove the host key this device paired with. Nothing \
                 was said to it. If Banda was set up anew there, pair again: banda pair <machine>",
            ))
        };
        let host = URL_SAFE_NO_PAD
            .decode(&kept.host_key)
            .map_err(|_| another())?;
        let proves = |message: String, sig: &str| {
            let sig = URL_SAFE_NO_PAD.decode(sig).map_err(|_| another())?;
            UnparsedPublicKey::new(&ED25519, &host)
                .verify(message.as_bytes(), &sig)
                .map_err(|_| another())
        };
        // The door answers no one's name: any Host serves.
        let (socket, _) = tokio_tungstenite::client_async("ws://door/ws", pipe)
            .await
            .map_err(|_| Failure::broken(nowhere))?;
        let mut client = Client::over(socket);
        let challenge: DoorFrame = client.read().await?;
        let DoorFrame::Challenge {
            nonce: door_nonce,
            host_key,
            time,
            protocol,
            sig,
        } = challenge
        else {
            return Err(Failure::broken("The door did not say its challenge."));
        };
        if host_key != kept.host_key {
            return Err(another());
        }
        proves(
            challenge_message(&door_nonce, &host_key, time, protocol),
            &sig,
        )?;
        if !(protocol.min..=protocol.max).contains(&PROTOCOL) {
            return Err(Failure::Refused(Refusal::new(
                Code::Protocol,
                format!(
                    "The engine there speaks protocols {} to {}, this banda {PROTOCOL}: update \
                     the older of the two.",
                    protocol.min, protocol.max
                ),
            )));
        }
        let mut mine = [0u8; 32];
        ring::rand::SystemRandom::new()
            .fill(&mut mine)
            .map_err(Failure::broken)?;
        let nonce = URL_SAFE_NO_PAD.encode(mine);
        // A program has no page, and so no origin: the empty line.
        let said = hello_message(&door_nonce, &host_key, "", &nonce);
        let hello = DeviceFrame::Hello {
            protocol: Protocols {
                min: PROTOCOL,
                max: PROTOCOL,
            },
            device: kept.device,
            nonce: nonce.clone(),
            sig: URL_SAFE_NO_PAD.encode(key.sign(said.as_bytes())),
        };
        client.write(&hello).await?;
        match client.welcomed().await? {
            Some(proved) if proved.host_key == kept.host_key => {
                proves(welcome_message(&nonce, proved.device), &proved.sig)?;
                Ok(client)
            }
            _ => Err(another()),
        }
    }

    /// Reads the engine's answer to a hello: its welcome, kept, and who the
    /// two ends proved to be at a door; or its goodbye, as a refusal.
    async fn welcomed(&mut self) -> Result<Option<banda_kernel::devices::Proved>, Failure> {
        let client = self;
        match client.receive().await? {
            EngineFrame::Welcome {
                fence,
                named,
                machine,
                apps,
                door,
                ..
            } => {
                client.fence = fence;
                client.named = named;
                client.machine = machine;
                client.apps = apps;
                Ok(door)
            }
            EngineFrame::Goodbye { reason, .. } => Err(Failure::Refused(reason)),
            _ => Err(Failure::broken("The engine did not say welcome.")),
        }
    }

    /// Whether the fence around the engine's Harnesses holds, as it said
    /// in its welcome.
    pub fn fence(&self) -> Option<&banda_kernel::Fence> {
        self.fence.as_ref()
    }

    /// What the engine said its machine is called and drawn by, as it said
    /// welcome.
    pub fn named(&self) -> Option<&banda_kernel::Named> {
        self.named.as_ref()
    }

    /// The log the engine's machine modules are followed by, as it said
    /// welcome.
    pub fn machine(&self) -> Option<ProjectId> {
        self.machine
    }

    /// The Apps the engine runs, with their versions, as it said welcome;
    /// none from an engine older than the list.
    pub fn apps(&self) -> &[banda_kernel::App] {
        &self.apps
    }

    /// Returns once the engine closed the connection, or it broke.
    pub async fn closed(mut self) {
        while self.receive().await.is_ok() {}
    }

    fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    async fn send(&mut self, frame: &ClientFrame) -> Result<(), Failure> {
        self.write(frame).await
    }

    async fn write(&mut self, frame: &impl serde::Serialize) -> Result<(), Failure> {
        let text = serde_json::to_string(frame).map_err(Failure::broken)?;
        self.socket
            .send(Message::text(text))
            .await
            .map_err(Failure::broken)
    }

    async fn receive(&mut self) -> Result<EngineFrame, Failure> {
        self.read().await
    }

    async fn read<T: serde::de::DeserializeOwned>(&mut self) -> Result<T, Failure> {
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
            not_after: None,
            params,
        })
        .await?;
        loop {
            if let EngineFrame::Result {
                id: answered,
                ok,
                error,
                ..
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

    /// Follows `project`'s events after `after`, beside what else this
    /// client follows: they come as [`Client::heard`] frames of the
    /// subscription this returns. A refusal comes as a `result` of it.
    pub async fn subscribe(
        &mut self,
        project: ProjectId,
        after: i64,
        filter: EventFilter,
    ) -> Result<u64, Failure> {
        let id = self.next_id();
        let frame = ClientFrame::Subscribe {
            id,
            project,
            after,
            filter,
        };
        self.send(&frame).await.map(|()| id)
    }

    /// Stops a subscription or a stream.
    pub async fn unsubscribe(&mut self, subscription: u64) -> Result<(), Failure> {
        let id = self.next_id();
        let frame = ClientFrame::Unsubscribe { id, subscription };
        self.send(&frame).await
    }

    /// Hears one of this machine's streams, such as `machine.named`, beside
    /// what else this client follows: its pieces come as [`Client::heard`]
    /// frames of the stream this returns.
    pub async fn stream(&mut self, method: &str) -> Result<u64, Failure> {
        self.stream_with(method, Value::Null).await
    }

    /// Hears the machine's stream `method`, asked with `params`.
    pub async fn stream_with(&mut self, method: &str, params: Value) -> Result<u64, Failure> {
        let id = self.next_id();
        let frame = ClientFrame::Stream {
            id,
            project: None,
            method: method.to_owned(),
            params,
        };
        self.send(&frame).await.map(|()| id)
    }

    /// The next frame the engine sends; an error once it closed the
    /// connection. One a caller stops waiting for is not lost.
    pub async fn heard(&mut self) -> Result<EngineFrame, Failure> {
        self.receive().await
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
