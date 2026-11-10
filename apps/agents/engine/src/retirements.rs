//! Removing an Account moves Threads in their own Project, once their
//! Turn ends. The old entry remains session provenance (ADR 0104).
use crate::{model::ThreadId, store, switching};
use banda_harnesses::Harnesses;
use banda_kernel::{Error, Listener, Refusal, Tx};

/// Also called immediately before opening a Turn's Harness, closing the
/// race between a queued Turn and the machine's listener.
pub fn one(tx: &mut Tx<'_>, harnesses: &Harnesses, thread: ThreadId) -> Result<(), Error> {
    let Some(now) = store::thread(tx.sql(), thread)? else {
        return Ok(());
    };
    if harnesses
        .find(&now.harness)
        .is_none_or(|h| h.retired.is_none())
    {
        return Ok(());
    }
    if let Some((to, by)) = harnesses
        .replacement(&now.harness)
        .map_err(Refusal::conflict)?
    {
        switching::switch(tx, by, thread, now.harness, to)?;
    }
    Ok(())
}

pub fn quiet(tx: &mut Tx<'_>, harnesses: &Harnesses) -> Result<(), Error> {
    for old in harnesses.retired() {
        // A destination disabled later must not roll back a Turn's end.
        // Its next start reports the refusal in the Thread.
        let Some((to, by)) = (match harnesses.replacement(&old.id) {
            Ok(destination) => destination,
            Err(error) => {
                tracing::warn!(%error, "a removed Account's Threads could not move");
                continue;
            }
        }) else {
            continue;
        };
        for thread in store::idle_on(tx.sql(), &old.id)? {
            switching::switch(tx, by, thread, old.id.clone(), to.clone())?;
        }
    }
    Ok(())
}

pub async fn follow(mut heard: Listener, harnesses: Harnesses, machine: bool) {
    while let Ok(Some(event)) = heard.next().await {
        let Some(project) = heard.project() else {
            return;
        };
        let choices = harnesses.clone();
        let written = if machine {
            heard
                .once(&event, move |tx| quiet(tx, &choices))
                .await
                .map(|_| ())
        } else {
            let ack = heard.ack(&event);
            project
                .write(move |tx| {
                    quiet(tx, &choices)?;
                    tx.ack(&ack)
                })
                .await
        };
        if let Err(error) = written {
            tracing::warn!(%error, "a Project could not apply Account removal");
            return;
        }
    }
}
