//! A turn while its Harness works, whichever kind of turn it is: one the
//! outbox started (`effects.rs`) and one the Agent went on with by itself
//! (`between.rs`) run the same way. What the session says is written into the Thread, and the turn ends as its Harness says;
//! when what it says cannot be written, the turn stops and fails.

use crate::acp::Said;
use crate::live::TurnRun;
use crate::rules::Ending;
use crate::transcript::{Holder, Transcript};
use std::future::Future;
use std::time::Duration;
use tokio::sync::mpsc;

/// How long a Harness may take to stop a turn that cannot go on.
const STOPPING: Duration = Duration::from_secs(10);

/// Runs `run`, which its session holds: what comes on `hear` is written
/// by `transcript`, and `ended` says how the Harness ended the turn.
pub async fn drive(
    run: &TurnRun,
    mut transcript: Transcript,
    hear: &mut mpsc::UnboundedReceiver<Said>,
    ended: impl Future<Output = Ending>,
) -> Ending {
    let mut ended = std::pin::pin!(ended);
    // Both at once: what says how the turn ended may be what feeds `hear`.
    let mut ending = None;
    let listened = {
        let mut listening = std::pin::pin!(transcript.listen(Holder::Turn(run), hear));
        loop {
            tokio::select! {
                listened = &mut listening => break listened,
                done = &mut ended, if ending.is_none() => ending = Some(done),
            }
        }
    };
    if let Err(reason) = listened {
        // What the Harness says cannot be written: the turn stops and
        // fails, unless the session already went on with another turn.
        if let Err(error) = run.stop() {
            tracing::warn!(%error, "a turn that could not be written could not be stopped");
        }
        if ending.is_none() {
            let _ = tokio::time::timeout(STOPPING, ended).await;
        }
        return Ending::failed(reason, None);
    }
    let ending = match ending {
        Some(ending) => ending,
        None => ended.await,
    };
    ending.resets(transcript.resets)
}
