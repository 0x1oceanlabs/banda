//! Archive's rules (ADR 0096, decision 4): which Thread a
//! Person may archive, and whether one still is. Pure: the caller brings
//! the Thread's times and state, all the engine's.

use crate::model::Archived;
use banda_kernel::Refusal;

/// Whether a Thread may be archived: not one at work, and not one that
/// asks, as what calls its Person is never put away.
pub fn may_archive(works: bool, asks: bool) -> Result<(), Refusal> {
    if asks {
        return Err(Refusal::conflict(
            "This Thread asks its Person: answer it before archiving it.",
        ));
    }
    if works {
        return Err(Refusal::conflict(
            "This Thread is at work: archive it once its turn ends.",
        ));
    }
    Ok(())
}

/// Whether a Thread is archived: its Person archived it, nothing happened
/// in it after (`changed`, its `updated_at`), and it may be archived still.
/// A message or a turn that ends brings it back, as a reply brings a
/// letter back in Gmail.
pub fn holds(archived: Option<Archived>, changed: i64, works: bool, asks: bool) -> bool {
    archived.is_some_and(|archived| changed <= archived.at) && !works && !asks
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: i64 = 1_000;

    #[test]
    fn a_thread_at_work_or_that_asks_is_never_archived() {
        assert!(may_archive(false, false).is_ok());
        assert!(may_archive(true, false).is_err());
        assert!(may_archive(false, true).is_err());
        let archived = Some(Archived { at: AT });
        assert!(holds(archived, AT, false, false));
        assert!(!holds(archived, AT, true, false), "at work");
        assert!(!holds(archived, AT, false, true), "it asks");
    }

    #[test]
    fn anything_new_after_the_archive_brings_it_back() {
        let archived = Some(Archived { at: AT });
        assert!(holds(archived, AT - 1, false, false));
        assert!(holds(archived, AT, false, false), "in the same moment");
        assert!(!holds(archived, AT + 1, false, false));
        assert!(!holds(None, 0, false, false), "never archived");
    }
}
