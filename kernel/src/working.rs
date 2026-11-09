//! How many Turns run on this host now, in every Project: each running
//! Turn holds one [`AtWork`] while it runs, and the engine keeps its
//! machine awake while the count is above nothing (ADR 0097, decision 1).
//! It names no module: the agents module holds it, and the engine reads
//! it.

use std::sync::Arc;
use tokio::sync::watch;

/// The count of what is at work. A clone counts the same.
#[derive(Clone, Debug)]
pub struct Working(Arc<watch::Sender<usize>>);

impl Working {
    /// A count of nothing at work.
    pub fn new() -> Working {
        Working(Arc::new(watch::Sender::new(0)))
    }

    /// One more at work, until the returned guard drops.
    pub fn hold(&self) -> AtWork {
        self.0.send_modify(|count| *count += 1);
        AtWork(self.0.clone())
    }

    /// How many are at work now, kept current.
    pub fn count(&self) -> watch::Receiver<usize> {
        self.0.subscribe()
    }
}

impl Default for Working {
    fn default() -> Working {
        Working::new()
    }
}

/// One at work, counted until it drops.
#[derive(Debug)]
pub struct AtWork(Arc<watch::Sender<usize>>);

impl Drop for AtWork {
    fn drop(&mut self) {
        self.0.send_modify(|count| *count = count.saturating_sub(1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_guard_counts_until_it_drops() {
        let working = Working::new();
        let mut count = working.count();
        assert_eq!(*count.borrow_and_update(), 0);

        let first = working.hold();
        let second = working.clone().hold();
        assert!(count.has_changed().unwrap());
        assert_eq!(*count.borrow_and_update(), 2, "a clone counts the same");

        drop(first);
        assert_eq!(*count.borrow_and_update(), 1);
        drop(second);
        assert_eq!(*count.borrow_and_update(), 0);
    }

    #[test]
    fn a_count_read_later_sees_what_holds_now() {
        let working = Working::new();
        let held = working.hold();
        assert_eq!(*working.count().borrow(), 1, "read after it was taken");
        drop(held);
        assert_eq!(*working.count().borrow(), 0);
    }
}
