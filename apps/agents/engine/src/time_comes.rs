//! A Later's time comes (ADR 0074, decision 3 as changed on 2026-11-09):
//! the host, which keeps the Later, is its one clock. As the time comes it
//! writes `thread.woke` by `time`, once, so every window and machine hears
//! the same waking, and one put off to go on by itself (decision 8) sends
//! its failed turn again. A time that passed while the engine was off
//! comes as it starts, with the moment it was due.

use crate::model::{ThreadId, Wake, Woke};
use crate::rules::later::asleep;
use crate::store;
use banda_kernel::{Error, EventFilter, Listener, Tx, now_ms};
use std::time::Duration;

/// The name of the module's listener of new Laters. It kept its name
/// from when it heard only those that go on by themselves, so its place
/// in the log holds.
pub const LISTENER: &str = "laters";

/// The facts that may bring a nearer time: a new Later.
pub fn put_off() -> EventFilter {
    EventFilter {
        module: Some("agents".into()),
        subject: None,
        kinds: Some(vec!["thread.later".into()]),
    }
}

/// Wakes each put-off Thread as its time comes. It hears new Laters, each
/// acked once the Laters are read again, looks again at least once a
/// minute, and stops with its Project.
pub async fn watch(mut heard: Listener) {
    let mut woken: Option<i64> = None;
    loop {
        let Some(project) = heard.project() else {
            return;
        };
        let now = now_ms();
        let timed = project.read(store::timed).await.unwrap_or_else(|error| {
            tracing::warn!(%error, "the Laters with a time were not read");
            Vec::new()
        });
        let (due, waiting): (Vec<_>, Vec<_>) = timed.into_iter().partition(|&(_, at)| at <= now);
        // One write each, so one that fails leaves the others, and is
        // tried again on the next look.
        for (thread, _) in due {
            if let Err(error) = project.write(move |tx| comes(tx, thread)).await {
                tracing::warn!(%error, "a put-off Thread did not wake at its time");
            }
        }
        drop(project);
        if let Some(seq) = woken.take()
            && let Err(error) = heard.ack_through(seq).await
        {
            tracing::warn!(%error, "the Laters' place in the log was not kept");
        }
        // Until the next one's time, a new Later, or a minute: a timer
        // stops while the machine sleeps, and the wall clock does not.
        let next = waiting.iter().map(|&(_, at)| at - now).min();
        let wait = next.map_or(LOOK, |ms| LOOK.min(Duration::from_millis(ms as u64)));
        match tokio::time::timeout(wait, heard.next()).await {
            Ok(Ok(Some(event))) => woken = Some(event.seq),
            Ok(Ok(None) | Err(_)) => return,
            Err(_) => {}
        }
    }
}

/// How long the host waits at most before it looks at the clock again.
const LOOK: Duration = Duration::from_secs(60);

/// `thread`'s time has come: it woke at that time, by `time`, as the one
/// who put it off, and a failed turn it goes on with goes again, once. A
/// Later that woke, or was put off again to a later time, stays as it is.
fn comes(tx: &mut Tx<'_>, thread: ThreadId) -> Result<(), Error> {
    let Some(mut later) = store::later(tx.sql(), thread)? else {
        return Ok(());
    };
    // Woken already, or put off again to a later time.
    if later.woke.is_some() || asleep(&later, tx.now()) {
        return Ok(());
    }
    let Some(at) = later.until else {
        return Ok(());
    };
    let (by, resume) = (later.by, later.resume.take());
    crate::laters::woke(tx, by, thread, later, Woke { at, by: Wake::Time })?;
    // Refused, it is not tried again: the Later has gone on once.
    if let Some(turn) = resume
        && let Err(error) = crate::retry(tx, by, turn)
    {
        tracing::warn!(%error, "a put-off Thread's failed turn did not go again");
    }
    Ok(())
}
