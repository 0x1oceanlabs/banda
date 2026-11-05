//! `agents.write`: a short run of a Thread's Harness, apart from the
//! Thread (ADR 0034, decision 3), as T3 Code's text model writes a
//! commit's message. It runs in a session of its own in the Project's
//! folder, on the Thread's model at the least effort the Harness offers
//! for it, planning and asking before it changes anything; whatever it
//! asks is refused, and nobody sees it. Only its reply comes back, and
//! the session is closed. Stopped, it stops at once, its turn cancelled
//! and its session closed all the same. The Thread's own session is not
//! touched.

use crate::acp::{Answer, Connection, Prompt, Said, Session};
use crate::model::{Mode, Settings, TurnState};
use crate::questions::refuse_once;
use crate::rules::Ending;
use banda_kernel::Refusal;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;

/// How long it may take, and how long a stop may take after it.
const TIME: Duration = Duration::from_secs(120);
const STOPPING: Duration = Duration::from_secs(5);

/// What the Harness replies to `prompt`, with the Thread's `settings`,
/// unless `stopped` comes first.
pub async fn write(
    connection: Arc<Connection>,
    folder: &Path,
    settings: &Settings,
    prompt: String,
    stopped: impl Future<Output = ()>,
) -> Result<String, Refusal> {
    tokio::pin!(stopped);
    let name = connection.process().name().to_owned();
    let mut opening = tokio::spawn({
        let (connection, folder) = (connection.clone(), folder.to_owned());
        async move { connection.aside(&folder).await }
    });
    let opened = tokio::select! {
        opened = &mut opening => opened.map_err(|_| Refusal::internal())?,
        () = &mut stopped => {
            // It goes on opening, to be closed once it has.
            tokio::spawn(async move {
                if let Ok(Ok(session)) = opening.await {
                    session.close().await;
                }
            });
            return Err(halted());
        }
    };
    let session = opened.map_err(|ending| refused(ending, &name, "could not start"))?;
    let ran = run(&session, settings, prompt, &name, stopped.as_mut()).await;
    session.close().await;
    ran
}

async fn run(
    session: &Session,
    settings: &Settings,
    prompt: String,
    name: &str,
    mut stopped: Pin<&mut impl Future<Output = ()>>,
) -> Result<String, Refusal> {
    let wanted = Settings {
        mode: Mode::Supervised,
        plan: true,
        options: settings.options.clone(),
    };
    // The model set first, as the levels it offers may be its own.
    let settled = async {
        session.settle(&wanted).await;
        session.least_effort().await;
    };
    tokio::select! {
        () = settled => {}
        () = &mut stopped => return Err(halted()),
    }
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
    let reply = tokio::select! {
        reply = heard => reply,
        () = tokio::time::sleep(TIME) => {
            let late = format!("{name} did not answer within two minutes.");
            return Err(cancel(session, &mut done, Refusal::conflict(late)).await);
        }
        () = &mut stopped => return Err(cancel(session, &mut done, halted()).await),
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

/// Cancels the turn and gives it a moment to stop, before its session is
/// closed; then says `why` it was.
async fn cancel(session: &Session, done: &mut JoinHandle<Ending>, why: Refusal) -> Refusal {
    let _ = session.cancel();
    let _ = tokio::time::timeout(STOPPING, done).await;
    why
}

/// What a run stopped by its caller says, which nobody hears.
fn halted() -> Refusal {
    Refusal::conflict("The run was stopped.")
}

/// Why it ended, or that `name` `did` so.
fn refused(ending: Ending, name: &str, did: &str) -> Refusal {
    Refusal::conflict(ending.reason.unwrap_or_else(|| format!("{name} {did}.")))
}
