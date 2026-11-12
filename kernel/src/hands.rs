//! What the Person has in hand on this host: how many terminals are open,
//! and when a key last reached one. The terminal module tells it, and the
//! updates module reads it, so the engine never restarts under the
//! Person's hands (ADR 0119, decision 3). It names no module, as
//! [`Working`](crate::Working) does not.

use std::sync::Arc;
use tokio::sync::watch;

/// How often a key wakes those who read [`InHand`]: one typing on does not
/// tick each key, only a key this long after the one before it. A reader
/// whose wait for quiet ends reads the newest key anyway.
pub const TYPED_TOLD_EVERY_MS: i64 = 60_000;

/// What the Person has in hand. A clone tells the same.
#[derive(Clone, Debug, Default)]
pub struct Hands(Arc<watch::Sender<InHand>>);

/// What [`Hands`] says now.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InHand {
    /// The terminals open on this host whose program has not ended.
    pub terminals: usize,
    /// When a key last reached one of them, in ms since the epoch: kept
    /// at each key, though readers are woken less often.
    pub typed: Option<i64>,
}

impl Hands {
    /// Nothing in hand.
    pub fn new() -> Hands {
        Hands::default()
    }

    /// `terminals` are open now.
    pub fn terminals(&self, terminals: usize) {
        self.0.send_if_modified(|now| {
            let changed = now.terminals != terminals;
            now.terminals = terminals;
            changed
        });
    }

    /// A key reached a terminal at `at`, ms since the epoch. Readers are
    /// woken by the first, and by one a minute or more after the one
    /// before it.
    pub fn typed(&self, at: i64) {
        self.0.send_if_modified(|now| {
            let tell = now
                .typed
                .is_none_or(|told| at - told >= TYPED_TOLD_EVERY_MS);
            if tell || now.typed.is_some_and(|before| at > before) {
                now.typed = Some(at);
            }
            tell
        });
    }

    /// What is in hand now, kept current.
    pub fn now(&self) -> watch::Receiver<InHand> {
        self.0.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminals_tell_each_change() {
        let hands = Hands::new();
        let mut now = hands.now();
        hands.terminals(2);
        assert!(now.has_changed().unwrap());
        assert_eq!(now.borrow_and_update().terminals, 2);
        hands.clone().terminals(2);
        assert!(!now.has_changed().unwrap(), "the same count tells nothing");
    }

    #[test]
    fn a_key_wakes_readers_once_a_minute_and_the_last_is_kept() {
        let hands = Hands::new();
        let mut now = hands.now();
        hands.typed(1_000);
        assert!(now.has_changed().unwrap(), "the first key tells");
        assert_eq!(now.borrow_and_update().typed, Some(1_000));

        hands.typed(30_000);
        assert!(!now.has_changed().unwrap(), "within a minute: told not");
        assert_eq!(now.borrow().typed, Some(30_000), "yet kept");

        hands.typed(90_000);
        assert!(now.has_changed().unwrap(), "a minute after the one before");
        assert_eq!(now.borrow_and_update().typed, Some(90_000));
    }
}
