//! `agents.write`: a short run of a Thread's Harness, apart from the
//! Thread (ADR 0034, decision 3), as T3 Code's text model writes a
//! commit's message. It runs in a session of its own in the Space's
//! folder, on the Thread's model at the least effort the Harness offers
//! for it, planning and asking before it changes anything; whatever it
//! asks is refused, and nobody sees it. Only its reply comes back, and
//! the session is closed. Stopped, its turn is cancelled and the session
//! closed all the same. The Thread's own session is not touched.

use crate::acp::{Answer, Connection, Prompt, Said, Session};
use crate::model::{Mode, Offer, OptionValue, Settings, TurnState};
use crate::questions::refuse_once;
use crate::rules::Ending;
use banda_kernel::Refusal;
use std::future::Future;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// How long it may take, and how long a stop may take after it.
const TIME: Duration = Duration::from_secs(120);
const STOPPING: Duration = Duration::from_secs(5);

/// Effort levels from the least, by the words Claude Code and Codex
/// have for them. `none`, no thinking at all, is left out: the least is
/// enough for a short reply, and some models take no `none`.
const LEVELS: [&str; 6] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/// What the Harness replies to `prompt`, with the Thread's `settings`,
/// unless `stopped` comes first.
pub async fn write(
    connection: Arc<Connection>,
    folder: &Path,
    settings: &Settings,
    prompt: String,
    stopped: impl Future<Output = ()>,
) -> Result<String, Refusal> {
    let name = connection.process().name().to_owned();
    let session = connection
        .aside(folder)
        .await
        .map_err(|ending| refused(ending, &name, "could not start"))?;
    let ran = run(&session, settings, prompt, &name, stopped).await;
    session.close().await;
    ran
}

async fn run(
    session: &Session,
    settings: &Settings,
    prompt: String,
    name: &str,
    stopped: impl Future<Output = ()>,
) -> Result<String, Refusal> {
    tokio::pin!(stopped);
    let mut wanted = Settings {
        mode: Mode::Supervised,
        plan: true,
        options: settings.options.clone(),
    };
    session.settle(&wanted).await;
    // The model set first, as the levels it offers may be its own.
    if let Some((effort, least)) = least_effort(&session.running().offer) {
        wanted.options.insert(effort, OptionValue::Choice(least));
        session.settle(&wanted).await;
    }
    // Stopped already: no prompt goes.
    tokio::select! {
        biased;
        () = &mut stopped => return Err(halted()),
        () = std::future::ready(()) => {}
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
    let heard = tokio::select! {
        heard = tokio::time::timeout(TIME, heard) => heard.map_err(|_| {
            Refusal::conflict(format!("{name} did not answer within two minutes."))
        }),
        () = &mut stopped => Err(halted()),
    };
    let reply = match heard {
        Ok(reply) => reply,
        Err(refusal) => {
            // Stopped, and given a moment to stop before it is closed.
            let _ = session.cancel();
            let _ = tokio::time::timeout(STOPPING, &mut done).await;
            return Err(refusal);
        }
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

/// The effort option `offer` has, and the least level it offers; none
/// when it has no such option or no level Banda knows.
fn least_effort(offer: &Offer) -> Option<(String, String)> {
    let effort = (offer.options.iter())
        .find(|option| option.category.as_deref() == Some("thought_level"))?;
    let least = (effort.choices.iter())
        .filter_map(|choice| Some((LEVELS.iter().position(|l| *l == choice.value)?, choice)))
        .min_by_key(|(rank, _)| *rank)?;
    Some((effort.id.clone(), least.1.value.clone()))
}

/// What a run stopped by its caller says, which nobody hears.
fn halted() -> Refusal {
    Refusal::conflict("The run was stopped.")
}

/// Why it ended, or that `name` `did` so.
fn refused(ending: Ending, name: &str, did: &str) -> Refusal {
    Refusal::conflict(ending.reason.unwrap_or_else(|| format!("{name} {did}.")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{HarnessOption, OptionChoice};

    fn option(id: &str, category: &str, values: &[&str]) -> HarnessOption {
        HarnessOption {
            id: id.to_owned(),
            name: id.to_owned(),
            description: None,
            value: OptionValue::Choice(values[0].to_owned()),
            choices: (values.iter())
                .map(|value| OptionChoice {
                    value: (*value).to_owned(),
                    name: (*value).to_owned(),
                    description: None,
                })
                .collect(),
            category: Some(category.to_owned()),
        }
    }

    fn offer(options: Vec<HarnessOption>) -> Offer {
        Offer {
            options,
            ..Offer::default()
        }
    }

    #[test]
    fn the_least_effort_is_the_lowest_level_the_harness_offers() {
        // Claude Code's, with its own "default".
        let claude = option(
            "effort",
            "thought_level",
            &["default", "xhigh", "low", "max"],
        );
        let model = option("model", "model", &["opus", "sonnet"]);
        assert_eq!(
            least_effort(&offer(vec![model.clone(), claude])),
            Some(("effort".into(), "low".into()))
        );
        // Codex's.
        let codex = option(
            "reasoning_effort",
            "thought_level",
            &["none", "high", "minimal", "low"],
        );
        assert_eq!(
            least_effort(&offer(vec![codex])),
            Some(("reasoning_effort".into(), "minimal".into()))
        );
        // No effort, or no level Banda knows: the options stay.
        assert_eq!(least_effort(&offer(vec![model])), None);
        let odd = option("effort", "thought_level", &["fast", "deep"]);
        assert_eq!(least_effort(&offer(vec![odd])), None);
    }
}
