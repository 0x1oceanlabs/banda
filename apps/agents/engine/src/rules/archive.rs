//! Archive's rules (ADR 0096, decision 4): which Thread a
//! Person may archive, whether one still is, and which they may delete
//! from there (ADR 0098, decision 14). Pure: the caller brings the
//! Thread's times and state, all the engine's.

use crate::model::Archived;
use banda_kernel::Refusal;

/// Whether a Thread may be archived: not one at work, and not one that
/// asks, as what calls its Person is never put away.
pub fn may_archive(works: bool, asks: bool) -> Result<(), Refusal> {
    idle(works, asks, ("archiving", "archive"))
}

/// Whether a Thread may be deleted: only one in Archive, the only place
/// to delete, so one that left it since its Person chose Delete, as a
/// Later woke it or a message came, keeps what came. And, as for archive,
/// not one at work, nor one that asks, so no turn goes on writing into a
/// Thread that is gone.
pub fn may_delete(
    archived: Option<Archived>,
    changed: i64,
    works: bool,
    asks: bool,
) -> Result<(), Refusal> {
    idle(works, asks, ("deleting", "delete"))?;
    if !holds(archived, changed, works, asks) {
        return Err(Refusal::conflict(
            "This Thread is not in Archive: archive it before deleting it.",
        ));
    }
    Ok(())
}

/// Whether a Thread is idle, so it may be put away: not at work, and not
/// one that asks, which comes first. `doing` and `act` name what is
/// asked, in the refusal's words.
fn idle(works: bool, asks: bool, (doing, act): (&str, &str)) -> Result<(), Refusal> {
    if asks {
        return Err(Refusal::conflict(format!(
            "This Thread asks its Person: answer it before {doing} it."
        )));
    }
    if works {
        return Err(Refusal::conflict(format!(
            "This Thread is at work: {act} it once its turn ends."
        )));
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
        let words = |refused: Result<(), Refusal>| refused.unwrap_err().message;
        assert_eq!(
            words(may_archive(true, false)),
            "This Thread is at work: archive it once its turn ends."
        );
        assert_eq!(
            words(may_archive(false, true)),
            "This Thread asks its Person: answer it before archiving it."
        );
        assert!(
            words(may_archive(true, true)).contains("answer it"),
            "it asks first"
        );
        let archived = Some(Archived { at: AT });
        assert!(holds(archived, AT, false, false));
        assert!(!holds(archived, AT, true, false), "at work");
        assert!(!holds(archived, AT, false, true), "it asks");
    }

    #[test]
    fn only_an_idle_thread_in_archive_is_deleted() {
        let archived = Some(Archived { at: AT });
        assert!(may_delete(archived, AT, false, false).is_ok());
        let words = |refused: Result<(), Refusal>| refused.unwrap_err().message;
        assert_eq!(
            words(may_delete(archived, AT, true, false)),
            "This Thread is at work: delete it once its turn ends."
        );
        assert_eq!(
            words(may_delete(archived, AT, false, true)),
            "This Thread asks its Person: answer it before deleting it."
        );
        let elsewhere = "This Thread is not in Archive: archive it before deleting it.";
        assert_eq!(words(may_delete(archived, AT + 1, false, false)), elsewhere);
        assert_eq!(words(may_delete(None, 0, false, false)), elsewhere);
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
