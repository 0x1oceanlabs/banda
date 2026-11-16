//! Whom this machine tells that a Thread calls its Person (ADR 0124,
//! decision 10; ADR 0081, decision 6; SE7): while the Person looks at
//! Banda on some device, that device's window tells them, as ever; while
//! they look at none, the machine pushes to each device that takes pushes.
//!
//! It reads who calls where everything else outside a window does: this
//! machine's line, as `banda status --follow` works it out (`status.rs`),
//! over a connection of its own to its own engine. A Thread calls as it
//! begins to ask, fails, or is done: one that called so before the
//! machine started, or before the Person looked away, is told of no more.

use crate::places::Places;
use crate::status::{Reader, ReaderGone, Status};
use banda_agents::counts::{CountedAs, CountedThread};
use banda_agents::model::ThreadId;
use banda_devices::{Paired, Pushed};
use std::collections::HashMap;

/// Tells `paired`'s devices of each Thread that begins to call, for as
/// long as the engine runs.
pub(crate) fn start(places: Places, paired: Paired) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        // Followed only while some device takes pushes: a machine with
        // none reads no line for nobody.
        let mut changes = paired.changes();
        loop {
            if paired.pushed().is_empty() {
                if changes.changed().await.is_err() {
                    return;
                }
                continue;
            }
            let mut teller = Teller {
                paired: paired.clone(),
                known: None,
            };
            let none_takes =
                async { while changes.changed().await.is_ok() && !paired.pushed().is_empty() {} };
            tokio::select! {
                _ = crate::status::watch(&places, &mut teller, None) => return,
                () = none_takes => {}
            }
        }
    })
}

struct Teller {
    paired: Paired,
    /// What each Thread counted as in the line before; none before the
    /// first, which tells of nothing: those called already.
    known: Option<HashMap<ThreadId, CountedAs>>,
}

impl Reader for Teller {
    fn take(&mut self, line: &Status) -> Result<(), ReaderGone> {
        let Some(agents) = &line.agents else {
            return Ok(());
        };
        let machine = line.named.as_ref().map(|named| named.name.as_str());
        let now = (agents.threads.iter())
            .map(|thread| (thread.thread, thread.state))
            .collect();
        let known = self.known.replace(now);
        let began: Vec<Pushed> = (known.iter())
            .flat_map(|known| began(known, &agents.threads))
            .filter_map(|thread| pushed(thread, machine))
            .collect();
        if began.is_empty() || self.paired.looking() {
            return Ok(());
        }
        for device in self.paired.pushed() {
            for pushed in began.clone() {
                let paired = self.paired.clone();
                tokio::spawn(async move {
                    if let Err(refusal) = paired.push(device, &pushed).await {
                        tracing::info!(%device, %refusal.message, "a call was not pushed");
                    }
                });
            }
        }
        Ok(())
    }
}

/// The `threads` that count as something else than `known` had them.
fn began<'a>(
    known: &'a HashMap<ThreadId, CountedAs>,
    threads: &'a [CountedThread],
) -> impl Iterator<Item = &'a CountedThread> {
    (threads.iter()).filter(|thread| known.get(&thread.thread) != Some(&thread.state))
}

/// What a push says of `thread`, on the machine called `machine`; none
/// for one that does not call its Person: it works, or only woke.
fn pushed(thread: &CountedThread, machine: Option<&str>) -> Option<Pushed> {
    let what = match thread.state {
        CountedAs::Asking => "Asks",
        CountedAs::Done => "Done",
        CountedAs::Failed => "Failed",
        CountedAs::Working | CountedAs::Woke => return None,
    };
    let at = machine.map_or(String::new(), |machine| format!(" on {machine}"));
    let words = (thread.calls.as_deref()).map_or(String::new(), |words| format!(": {words}"));
    Some(Pushed {
        title: format!("{} · {}", thread.title, thread.project_name),
        body: format!("{what}{at}{words}"),
        // A later call of the same Thread takes the place of this one.
        tag: thread.thread.to_string(),
        to: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::ProjectId;

    fn thread(state: CountedAs, calls: Option<&str>) -> CountedThread {
        CountedThread {
            thread: ThreadId::new(),
            title: "Deploy docs".to_owned(),
            project: ProjectId::new(),
            project_name: "banda".to_owned(),
            state,
            calls: calls.map(str::to_owned),
        }
    }

    #[test]
    fn a_push_says_the_thread_what_happened_and_where() {
        let asks = thread(CountedAs::Asking, Some("Keep the old rows, or drop them?"));
        let said = pushed(&asks, Some("arc")).unwrap();
        assert_eq!(said.title, "Deploy docs · banda");
        assert_eq!(said.body, "Asks on arc: Keep the old rows, or drop them?");
        assert_eq!(said.tag, asks.thread.to_string());

        let done = pushed(&thread(CountedAs::Done, None), Some("devbox")).unwrap();
        assert_eq!(done.body, "Done on devbox");
        // A machine with no name of its own says none.
        let failed = pushed(&thread(CountedAs::Failed, Some("Out of credit")), None).unwrap();
        assert_eq!(failed.body, "Failed: Out of credit");

        assert!(pushed(&thread(CountedAs::Working, None), None).is_none());
        assert!(pushed(&thread(CountedAs::Woke, None), None).is_none());
    }

    #[test]
    fn a_thread_is_told_of_as_it_begins_to_call_and_not_while_it_goes_on() {
        let mut working = thread(CountedAs::Working, None);
        let asking = thread(CountedAs::Asking, Some("Yes?"));
        let known: HashMap<_, _> = [&working, &asking]
            .map(|thread| (thread.thread, thread.state))
            .into();
        // Nothing changed: nothing began.
        let same = [working.clone(), asking.clone()];
        assert_eq!(began(&known, &same).count(), 0);
        // The one at work is done, and a new one fails; the one that
        // asked goes on asking.
        working.state = CountedAs::Done;
        let failed = thread(CountedAs::Failed, None);
        let now = [working.clone(), asking, failed.clone()];
        let told: Vec<_> = began(&known, &now).map(|thread| thread.thread).collect();
        assert_eq!(told, [working.thread, failed.thread]);
    }
}
