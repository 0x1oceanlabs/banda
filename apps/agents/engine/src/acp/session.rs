//! A Harness's session for one Thread: a turn's prompt, a message sent
//! into it, a stop, and the options it runs with.

use super::*;

/// How long a Harness may take to say whether a message joins its turn.
const STEERING: Duration = Duration::from_secs(30);
/// How long a Harness may take to close a session.
const CLOSING: Duration = Duration::from_secs(10);
/// A Harness's session for one Thread, in the process it runs in: what a
/// turn does there goes through it.
#[derive(Clone)]
pub struct Session {
    connection: Arc<Connection>,
    id: acp::SessionId,
}

/// A session held without its Harness's process, by what should stop
/// once the process is let go.
#[derive(Clone)]
pub struct WeakSession {
    connection: Weak<Connection>,
    id: acp::SessionId,
}

impl WeakSession {
    /// The session, while its process runs.
    pub fn upgrade(&self) -> Option<Session> {
        let connection = self.connection.upgrade()?;
        Some(Session {
            connection,
            id: self.id.clone(),
        })
    }

    /// A session whose process never ran, for a test of what holds one.
    #[cfg(test)]
    pub fn gone(id: &str) -> WeakSession {
        WeakSession {
            connection: Weak::new(),
            id: acp::SessionId::new(id),
        }
    }
}

/// What reaches whoever hears a Thread's Crews (ADR 0103, decision 9).
pub enum CrewSaid {
    /// A raw frame of Claude's.
    Raw(Sdk),
    /// What an agent of the one Crew at work, Claude's task `task`, did
    /// between turns: its call, a change of it, or its Question.
    Said { task: String, said: Said },
}

/// What a turn sends the Harness: its message's text and images.
pub struct Prompt {
    pub text: String,
    /// A skill the message names, as Claude Code runs one: `/name` and
    /// what follows, after the text (issue #149).
    pub command: Option<String>,
    pub images: Vec<PromptImage>,
}

/// An image as a Harness gets it: its kind and its bytes.
pub struct PromptImage {
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// What became of a message sent into a running turn.
#[derive(Debug, PartialEq, Eq)]
pub enum Steered {
    /// It joined the turn: what the Agent says of it comes with the turn.
    Joined,
    /// No turn could take it, as one that just ended: it needs its own.
    NotNow,
}

/// `_session/steering`, which Claude Code's and Codex's adapters share
/// (ACP PR #1261): a message into the session's running turn. With
/// `promptRequired` an adapter whose turn ended starts none by itself; the
/// engine queues the message instead.
#[derive(Debug, Clone, Serialize, Deserialize, agent_client_protocol::JsonRpcRequest)]
#[request(method = "_session/steering", response = SteeringResponse)]
#[serde(rename_all = "camelCase")]
struct SteeringRequest {
    session_id: acp::SessionId,
    prompt: Vec<acp::ContentBlock>,
    #[serde(rename = "_meta")]
    meta: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, agent_client_protocol::JsonRpcResponse)]
struct SteeringResponse {
    outcome: SteeringOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SteeringOutcome {
    Injected,
    /// No turn runs, so none took it.
    PromptRequired,
    /// Only without `promptRequired`: the adapter ran the message as a
    /// turn of its own, whose words reach no turn here.
    StartedNewTurn,
    /// It failed, or the adapter answered what this engine does not know.
    #[serde(other)]
    Other,
}

/// Where a Harness declares that it takes messages into a running turn,
/// and where each such message says what an idle session does with it.
pub(super) const STEERING_META: &str = "steering";
/// An idle session leaves the message to the engine.
const LEAVE_IT: &str = "promptRequired";
/// A prompt as ACP content: its text, its command, then its images.
fn blocks(
    Prompt {
        text,
        command,
        images,
    }: &Prompt,
) -> Vec<acp::ContentBlock> {
    let texts = (!text.is_empty())
        .then_some(text)
        .into_iter()
        .chain(command);
    let text = texts.map(|text| acp::ContentBlock::Text(acp::TextContent::new(text)));
    let images = images.iter().map(|image| {
        acp::ContentBlock::Image(acp::ImageContent::new(
            BASE64.encode(&image.bytes),
            image.mime.clone(),
        ))
    });
    text.into_iter().chain(images).collect()
}

impl Session {
    pub(super) fn new(connection: &Arc<Connection>, id: acp::SessionId) -> Session {
        Session {
            connection: connection.clone(),
            id,
        }
    }

    /// Whether `other` is this session.
    pub fn is(&self, other: &Session) -> bool {
        self.runs_in(&other.connection) && self.id == other.id
    }

    /// Whether the session runs in `connection`, the Harness's process.
    pub fn runs_in(&self, connection: &Arc<Connection>) -> bool {
        Arc::ptr_eq(&self.connection, connection)
    }

    /// The Harness's name, for plain words.
    pub fn name(&self) -> &str {
        self.connection.process.name()
    }

    /// The ID of the Harness entry its process runs.
    pub fn harness(&self) -> &str {
        self.connection.process.harness()
    }

    /// Whether the Harness takes a message into a running turn.
    pub fn steers(&self) -> bool {
        self.connection.steers()
    }

    /// Keeps the Harness's process from being let go as idle, while the
    /// returned guard lives.
    pub fn keep(&self) -> Held {
        self.connection.keep()
    }

    /// Marks the Harness's process as just used.
    pub fn touch(&self) {
        self.connection.touch();
    }

    /// Holds the session without keeping its Harness's process.
    pub fn downgrade(&self) -> WeakSession {
        WeakSession {
            connection: Arc::downgrade(&self.connection),
            id: self.id.clone(),
        }
    }

    /// Whether a turn's prompt runs in the session now.
    pub fn prompting(&self) -> bool {
        self.connection.routes.prompting(&self.id)
    }

    /// Hears what the session says between the engine's turns, from now on;
    /// `None` while someone already hears it. Nobody hears it any more once
    /// the Harness is gone.
    pub fn between(&self) -> Option<mpsc::UnboundedReceiver<Between>> {
        self.connection.routes.hear(&self.id)
    }

    /// Hears what the session's sub-agents say, from now on, apart from
    /// its turns; `None` while someone already hears them. Nobody hears
    /// them any more once the session closes or the Harness is gone.
    pub fn lanes(&self) -> Option<mpsc::UnboundedReceiver<LaneSaid>> {
        self.connection.routes.hear_lanes(&self.id)
    }

    /// Hears what the session's Crews say, from now on; `None` while
    /// someone already hears them. Nobody hears them any more once the
    /// session closes or the Harness is gone.
    pub fn crews(&self) -> Option<mpsc::UnboundedReceiver<CrewSaid>> {
        self.connection.routes.hear_crews(&self.id)
    }

    /// The task of the one Crew at work in the session's background, if
    /// exactly one is (ADR 0103, decision 28).
    pub fn crew_alone(&self) -> Option<String> {
        self.connection.routes.crew_alone(&self.id)
    }

    /// Hands what an agent of Crew `task` did between turns to whoever
    /// hears the session's Crews; given back when nobody does.
    pub fn tell_crew(&self, task: String, said: Said) -> Result<(), Box<Said>> {
        let Some(crews) = self.connection.routes.crews_of(&self.id) else {
            return Err(Box::new(said));
        };
        crews
            .send(CrewSaid::Said { task, said })
            .map_err(|error| match error.0 {
                CrewSaid::Said { said, .. } => Box::new(said),
                CrewSaid::Raw(_) => unreachable!("sent as said"),
            })
    }

    /// Sets the session's options so it runs as `wanted`: one at a time,
    /// since an option may change what another offers. What it runs with
    /// then, and in plain words each setting the Harness did not take.
    pub async fn settle(&self, wanted: &Settings) -> (Running, Vec<String>) {
        let (connection, session) = (&*self.connection, &self.id);
        let (mut tried, mut refused) = (Vec::new(), Vec::new());
        let known = loop {
            // Read again each time: an update may have come since.
            let known = connection.learned.lock().unwrap().get(session).cloned();
            let known = known.unwrap_or_default();
            let Some((id, value)) = next_change(&known, wanted, &tried) else {
                break known;
            };
            let name = known
                .options
                .iter()
                .find(|o| *o.id.0 == *id)
                .map_or_else(|| id.clone(), |o| o.name.clone());
            let set = acp::SetSessionConfigOptionRequest::new(
                session.clone(),
                acp::SessionConfigId::new(id.as_str()),
                value,
            );
            tried.push(id);
            if let Err(why) = self.set(set, &name).await {
                refused.push(why);
            }
        };
        let running = connection.runs(&known);
        let mode_set = known
            .options
            .iter()
            .any(|o| is_mode(o) && tried.iter().any(|t| **t == *o.id.0));
        let planning = wanted.plan && running.plan;
        if running.native && mode_set && !planning && running.mode != Some(wanted.mode) {
            let runs = running.mode.map_or("a mode of its own", Mode::name);
            refused.push(format!(
                "{} offers no {} here, so it runs in {runs}.",
                connection.process.name(),
                wanted.mode.name()
            ));
        }
        (running, refused)
    }

    /// Sets one option, named `name`, and learns what the session runs
    /// with then; or says in plain words why it did not.
    async fn set(&self, set: acp::SetSessionConfigOptionRequest, name: &str) -> Result<(), String> {
        let connection = &*self.connection;
        let asked = connection.process.cx().send_request(set).block_task();
        match timeout(OPENING, asked).await {
            Ok(Ok(answer)) => {
                learn(&connection.learned, &self.id, answer.config_options);
                Ok(())
            }
            Ok(Err(error)) => Err(format!(
                "{} did not take the setting {name}: {}",
                connection.process.name(),
                error.message
            )),
            Err(_) => Err(format!(
                "{} did not answer when Banda set {name}.",
                connection.process.name()
            )),
        }
    }

    /// Lowers the session's effort to the least it offers, for a short
    /// run that needs little thinking; a session with no effort, or at
    /// the least already, stays as it is.
    pub async fn least_effort(&self) {
        let known = (self.connection.learned.lock().unwrap())
            .get(&self.id)
            .map(|known| known.options.clone())
            .unwrap_or_default();
        let Some((id, name, least)) = least_effort(&known) else {
            return;
        };
        let set = acp::SetSessionConfigOptionRequest::new(
            self.id.clone(),
            acp::SessionConfigId::new(id.as_str()),
            acp::SessionConfigOptionValue::value_id(least),
        );
        if let Err(why) = self.set(set, &name).await {
            tracing::info!(%why, "a short run keeps its effort");
        }
    }

    /// Sends a prompt: its text, then its images. What the Harness says
    /// comes on the receiver; the returned task ends with the turn.
    ///
    /// The turn's route ends as the prompt's answer is dispatched, before
    /// anything the Harness says after it is routed: that is between turns.
    pub fn prompt(&self, prompt: &Prompt) -> (mpsc::UnboundedReceiver<Said>, JoinHandle<Ending>) {
        let (connection, session) = (&*self.connection, &self.id);
        connection.touch();
        let (hear, route) = connection.routes.prompt(session);
        let request = acp::PromptRequest::new(session.clone(), blocks(prompt));
        let (told, answered) = oneshot::channel();
        let (routes, activity) = (connection.routes.clone(), connection.activity.clone());
        let (id, ends) = (session.clone(), route.clone());
        // Sent here, not in the task: a stop that follows must reach the
        // Harness after the prompt it stops. The answer is handled in the
        // connection's order, so what comes after it is routed once the
        // turn's route has ended. The callback never fails, as that would
        // end the connection.
        let prepared = connection.process.cx().prepare_request(request);
        let sent = prepared.on_receiving_result(move |answer| async move {
            activity.touch();
            routes.ended(&id, &ends);
            let _ = told.send(answer);
            Ok(())
        });
        let (routes, session) = (connection.routes.clone(), session.clone());
        let name = connection.process.name().to_owned();
        let done = tokio::spawn(async move {
            // No answer means the connection's tasks have gone, as its
            // Harness has: the prompt was never sent, or never answered.
            let answer = match sent {
                Ok(()) => answered.await.ok(),
                Err(_) => None,
            };
            // Unless its answer ended the route already.
            routes.ended(&session, &route);
            match answer {
                Some(Ok(answer)) => ending(&answer.stop_reason),
                Some(Err(error)) if !gone(&error) => failed(&name, &error),
                _ => Ending::failed(
                    format!("{name} stopped while it worked."),
                    Some(Failure::HarnessStopped),
                ),
            }
        });
        (hear, done)
    }

    /// Closes the session on the Harness when it can, and forgets what
    /// was learned of it here. A Thread's session is never closed; a
    /// short run's is, once it ended.
    pub async fn close(&self) {
        let connection = &*self.connection;
        if connection.agreed.closes {
            let close = acp::CloseSessionRequest::new(self.id.clone());
            let asked = connection.process.cx().send_request(close).block_task();
            if let Ok(Err(error)) = timeout(CLOSING, asked).await {
                tracing::info!(%error, "the Harness could not close a session");
            }
        }
        connection.learned.lock().unwrap().remove(&self.id);
        connection.routes.forget(&self.id);
    }

    /// What the session last said it has used, if it has.
    pub fn usage(&self) -> Option<Usage> {
        let learned = self.connection.learned.lock().unwrap();
        learned.get(&self.id)?.usage.clone()
    }

    /// What the session runs with, as it last said.
    pub fn running(&self) -> Running {
        let connection = &self.connection;
        update(&connection.learned, &self.id, |known| {
            connection.runs(known)
        })
    }

    /// Sends a message into the session's running turn.
    pub async fn steer(&self, prompt: &Prompt) -> Result<Steered, String> {
        let (connection, session) = (&*self.connection, &self.id);
        let request = SteeringRequest {
            session_id: session.clone(),
            prompt: blocks(prompt),
            meta: serde_json::json!({ STEERING_META: { "idleBehavior": LEAVE_IT } }),
        };
        let sent = connection.process.cx().send_request(request).block_task();
        let answer = timeout(STEERING, sent)
            .await
            .map_err(|_| {
                format!(
                    "{} did not take the message in time.",
                    connection.process.name()
                )
            })?
            .map_err(plain)?;
        match answer.outcome {
            SteeringOutcome::Injected => Ok(Steered::Joined),
            SteeringOutcome::PromptRequired => Ok(Steered::NotNow),
            SteeringOutcome::StartedNewTurn => {
                tracing::warn!(harness = %connection.process.harness(), "a steered message started a turn of its own");
                Ok(Steered::Joined)
            }
            SteeringOutcome::Other => Err(format!(
                "{} could not take the message.",
                connection.process.name()
            )),
        }
    }

    /// Asks the Harness to stop the sub-agent of this session whose child
    /// session is `child`, alone: only one of its own that the Harness lets
    /// a client stop (ADR 0103, decision 23).
    pub fn cancel_child(&self, child: &str) -> Result<(), String> {
        let child = acp::SessionId::new(child);
        let known = self.connection.routes.child(&child);
        match known {
            Some(known) if known.root == self.id && known.cancel => {}
            Some(known) if known.root == self.id => {
                return Err(format!(
                    "{} does not let Banda stop this sub-agent alone.",
                    self.name()
                ));
            }
            _ => return Err("This sub-agent is not this Thread's.".to_owned()),
        }
        let cancel = acp::CancelNotification::new(child);
        self.connection
            .process
            .cx()
            .send_notification(cancel)
            .map_err(plain)
    }

    /// Asks the Harness to stop the session's turn.
    pub fn cancel(&self) -> Result<(), String> {
        let cancel = acp::CancelNotification::new(self.id.clone());
        self.connection
            .process
            .cx()
            .send_notification(cancel)
            .map_err(plain)
    }
}
