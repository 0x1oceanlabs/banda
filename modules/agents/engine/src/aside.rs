//! `agents.write`: a short run of a Thread's Harness, apart from the
//! Thread (ADR 0034, decision 3), as T3 Code's text model writes a
//! commit's message. It runs in a session of its own in the Space's
//! folder, on the Thread's model, planning and asking before it changes
//! anything; whatever it asks is refused, and nobody sees it. Only its
//! reply comes back, and the session is closed. The Thread's own session
//! is not touched.

use crate::acp::{Answer, Connection, Prompt, Said, Session};
use crate::model::{Mode, Settings, TurnState};
use crate::questions::refuse_once;
use crate::rules::Ending;
use banda_kernel::Refusal;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// How long it may take, and how long a stop may take after it.
const TIME: Duration = Duration::from_secs(120);
const STOPPING: Duration = Duration::from_secs(5);

/// What the Harness replies to `prompt`, with the Thread's `settings`.
pub async fn write(
    connection: Arc<Connection>,
    folder: &Path,
    settings: &Settings,
    prompt: String,
) -> Result<String, Refusal> {
    let name = connection.process().name().to_owned();
    let session = connection
        .aside(folder)
        .await
        .map_err(|ending| refused(ending, &name, "could not start"))?;
    let ran = run(&session, settings, prompt, &name).await;
    session.close().await;
    ran
}

async fn run(
    session: &Session,
    settings: &Settings,
    prompt: String,
    name: &str,
) -> Result<String, Refusal> {
    let wanted = Settings {
        mode: Mode::Supervised,
        plan: true,
        options: settings.options.clone(),
    };
    session.settle(&wanted).await;
    let prompt = Prompt {
        text: prompt,
        command: None,
        images: Vec::new(),
    };
    let (mut hear, mut done) = session.prompt(&prompt);
    let heard = async {
        let mut reply = String::new();
        while let Some(said) = hear.recv().await {
            match said {
                Said::Reply { text, .. } => reply.push_str(&text),
                // Nobody is there to answer: it may not, whatever it asks.
                Said::Asks {
                    offered, answer, ..
                } => {
                    let _ = answer.send(match refuse_once(&offered) {
                        Some(id) => Answer::Chose(id.to_owned()),
                        None => Answer::Cancelled,
                    });
                }
                _ => {}
            }
        }
        reply
    };
    let Ok(reply) = tokio::time::timeout(TIME, heard).await else {
        // Stopped, and given a moment to stop before it is closed.
        let _ = session.cancel();
        let _ = tokio::time::timeout(STOPPING, &mut done).await;
        return Err(Refusal::conflict(format!(
            "{name} did not answer within two minutes."
        )));
    };
    let ending = done.await.map_err(|_| Refusal::internal())?;
    if ending.state != TurnState::Done {
        return Err(refused(ending, name, "did not answer"));
    }
    match reply.trim() {
        "" => Err(Refusal::conflict(format!("{name} wrote nothing."))),
        reply => Ok(reply.to_owned()),
    }
}

/// Why it ended, or that `name` `did` so.
fn refused(ending: Ending, name: &str, did: &str) -> Refusal {
    Refusal::conflict(ending.reason.unwrap_or_else(|| format!("{name} {did}.")))
}
