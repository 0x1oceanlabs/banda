//! A Later that goes on by itself (ADR 0074, decision 8): as its time
//! comes, the Thread's failed turn goes again, once, as after a usage
//! limit resets. It is the one timer of a Later: every other reader
//! compares `until` with its own clock.

use crate::model::ThreadId;
use crate::store;
use banda_kernel::{Error, EventFilter, Listener, Tx, now_ms};
use std::time::Duration;

/// The name of the module's listener of new Laters.
pub const LISTENER: &str = "laters";

/// The facts that may bring a turn that goes on by itself: a new Later.
pub fn put_off() -> EventFilter {
    EventFilter {
        module: Some("agents".into()),
        subject: None,
        kinds: Some(vec!["thread.later".into()]),
    }
}

/// Goes on with each Thread put off to go on by itself as its time comes
/// (ADR 0074, decision 8): its failed turn goes again. A time that passed
/// while the engine was off goes as it starts. It hears new Laters, each
/// acked once the Laters are read again, and stops with its Project.
pub async fn resume(mut heard: Listener) {
    let mut woken: Option<i64> = None;
    loop {
        let Some(project) = heard.project() else {
            return;
        };
        let due = match project.read(store::resuming).await {
            Ok(due) => due,
            Err(error) => {
                tracing::warn!(%error, "the Laters that go on were not read");
                return;
            }
        };
        let now = now_ms();
        let times = due.iter().filter_map(|(_, later)| later.until);
        let next = times.filter(|&until| until > now).min();
        for (thread, _) in due
            .iter()
            .filter(|(_, later)| later.until.is_some_and(|until| until <= now))
        {
            let thread = *thread;
            if let Err(error) = project.write(move |tx| go_on(tx, thread)).await {
                tracing::warn!(%error, "a put-off Thread's turn did not go on");
            }
        }
        drop(project);
        if let Some(seq) = woken.take()
            && let Err(error) = heard.ack_through(seq).await
        {
            tracing::warn!(%error, "the Laters' place in the log was not kept");
        }
        // Until the next one's time, or a new Later.
        let wait = next.map_or(Duration::MAX, |at| Duration::from_millis((at - now) as u64));
        match tokio::time::timeout(wait, heard.next()).await {
            Ok(Ok(Some(event))) => woken = Some(event.seq),
            Ok(Ok(None) | Err(_)) => return,
            Err(_) => {}
        }
    }
}

/// Sends `thread`'s failed turn again, as the one who put it off, once:
/// the Later no longer goes on after. One that is no longer its latest
/// stays as it is.
fn go_on(tx: &mut Tx<'_>, thread: ThreadId) -> Result<(), Error> {
    let found = store::later(tx.sql(), thread)?;
    let Some(mut later) = found.filter(|later| later.woke.is_none()) else {
        return Ok(());
    };
    let Some(turn) = later.resume.take() else {
        return Ok(());
    };
    store::set_later(tx.sql(), thread, &later)?;
    // Refused, it is not tried again: the Later has gone on once.
    if let Err(error) = crate::retry(tx, later.by, turn) {
        tracing::warn!(%error, "a put-off Thread's failed turn did not go again");
    }
    Ok(())
}
