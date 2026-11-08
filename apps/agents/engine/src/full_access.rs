//! Full access and the fence (ADR 0083, decisions 1 and 2): an Agent in
//! Full access acts as the Person, so it does only where the fence keeps
//! Banda's own things out of its reach, or where the Person chose it
//! knowing it does not.
//!
//! - A new Thread nobody chose a mode for starts in Full access where the
//!   fence holds whole ([`Fence::holds_whole`]), and Supervised anywhere
//!   else: a fence that holds partly, a user in the `docker` group, no
//!   fence ([`unchosen`]).
//! - As a Thread's mode becomes Full access, it is marked with how the
//!   fence stood then ([`Chosen`]): one the Person chose where the fence
//!   does not hold, as their own `agents.toml` says too, runs so.
//! - A turn of a Thread in Full access that the fence does not keep now
//!   runs Supervised, and its Thread stays so, unless its Person chose it
//!   so ([`runs_supervised`]). Its `thread.configured` says why
//!   ([`WhySupervised`]), and whether its Full access was from before the
//!   fence.

use crate::model::{Mode, WhySupervised};
use banda_kernel::Fence;
use serde::{Deserialize, Serialize};

/// How a Thread's Full access was chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Chosen {
    /// Where the fence held whole.
    Fenced,
    /// By its Person, where the fence did not: it runs so.
    Unfenced,
}

/// The mode of a new Thread nobody chose one for, with `fence` as it is.
pub fn unchosen(fence: &Fence) -> Mode {
    match fence.holds_whole() {
        true => Mode::FullAccess,
        false => Mode::Supervised,
    }
}

/// The mark of a Thread whose mode becomes `mode` now, with `fence` as it
/// is: none but for Full access.
pub fn chosen(mode: Mode, fence: &Fence) -> Option<Chosen> {
    (mode == Mode::FullAccess).then(|| match fence.holds_whole() {
        true => Chosen::Fenced,
        false => Chosen::Unfenced,
    })
}

/// Whether a turn of a Thread in `mode`, marked `chosen`, runs Supervised
/// instead, with `fence` as it is now, and why: when it is in Full access
/// that the fence does not keep, and its Person did not choose it so.
pub fn runs_supervised(mode: Mode, chosen: Option<Chosen>, fence: &Fence) -> Option<WhySupervised> {
    if mode != Mode::FullAccess || fence.holds_whole() {
        return None;
    }
    let before = match chosen {
        Some(Chosen::Unfenced) => return None,
        Some(Chosen::Fenced) => false,
        None => true,
    };
    Some(WhySupervised {
        before,
        fence: fence.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use banda_kernel::{FenceLayer, FenceWhy};

    fn holds() -> Fence {
        Fence::holds(vec![FenceLayer::Namespaces, FenceLayer::Landlock], false)
    }

    fn partly() -> Fence {
        Fence::holds(vec![FenceLayer::Namespaces], false)
    }

    fn docker() -> Fence {
        Fence::holds(vec![FenceLayer::Namespaces, FenceLayer::Landlock], true)
    }

    fn missing() -> Fence {
        Fence::missing(FenceWhy::NoUserNamespaces, "no")
    }

    /// Whole but for a link in Banda's config an Agent could move.
    fn movable() -> Fence {
        holds().with_movable(vec!["/home/p/.config/banda/agents.toml".to_owned()])
    }

    #[test]
    fn a_new_thread_starts_in_full_access_only_where_the_fence_holds_whole() {
        assert_eq!(unchosen(&holds()), Mode::FullAccess);
        for fence in [partly(), docker(), movable(), missing(), Fence::not_built()] {
            assert_eq!(unchosen(&fence), Mode::Supervised, "{fence:?}");
        }
    }

    #[test]
    fn full_access_is_marked_with_how_the_fence_stood_as_it_was_chosen() {
        assert_eq!(chosen(Mode::FullAccess, &holds()), Some(Chosen::Fenced));
        for fence in [partly(), docker(), missing()] {
            assert_eq!(chosen(Mode::FullAccess, &fence), Some(Chosen::Unfenced));
        }
        for mode in [Mode::Supervised, Mode::AcceptEdits, Mode::Auto] {
            assert_eq!(chosen(mode, &holds()), None);
            assert_eq!(chosen(mode, &missing()), None);
        }
    }

    #[test]
    fn a_turn_runs_supervised_where_the_fence_does_not_keep_full_access_its_person_did_not_choose()
    {
        // The table: the mode, its mark, the fence now, and how it runs.
        let full = Mode::FullAccess;
        let rows: [(Mode, Option<Chosen>, Fence, Option<bool>); 12] = [
            // The fence holds whole: as it is, however it was chosen.
            (full, None, holds(), None),
            (full, Some(Chosen::Fenced), holds(), None),
            (full, Some(Chosen::Unfenced), holds(), None),
            // From before the fence: Supervised, said so as from before.
            (full, None, missing(), Some(true)),
            (full, None, partly(), Some(true)),
            (full, None, docker(), Some(true)),
            // Chosen where the fence held, which does not now.
            (full, Some(Chosen::Fenced), missing(), Some(false)),
            (full, Some(Chosen::Fenced), partly(), Some(false)),
            // Chosen by its Person where it did not hold: as chosen.
            (full, Some(Chosen::Unfenced), missing(), None),
            (full, Some(Chosen::Unfenced), docker(), None),
            // Any other mode runs as it is.
            (Mode::Supervised, None, missing(), None),
            (Mode::Auto, None, missing(), None),
        ];
        for (mode, mark, fence, said) in rows {
            let ran = runs_supervised(mode, mark, &fence);
            assert_eq!(
                ran.as_ref().map(|supervised| supervised.before),
                said,
                "{mode:?} {mark:?} {fence:?}"
            );
            if let Some(supervised) = ran {
                assert_eq!(supervised.fence, fence);
            }
        }
    }
}
