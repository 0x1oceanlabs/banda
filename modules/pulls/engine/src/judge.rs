//! What a pull request needs, and whose turn it is (ADR 0076, decision 3),
//! worked out from what GitHub last said of it.

use crate::model::{Checks, Need, Review, Snapshot, State, Turn};

/// The one thing it needs, the most urgent first.
pub fn need(snapshot: &Snapshot) -> Need {
    match snapshot.state {
        State::Merged => return Need::Merged,
        State::Closed => return Need::Closed,
        State::Open => {}
    }
    if snapshot.conflicts {
        return Need::Conflicts;
    }
    if snapshot.review == Some(Review::ChangesRequested) {
        return Need::Changes;
    }
    if snapshot.checks == Some(Checks::Failing) {
        return Need::Failing;
    }
    let green = matches!(snapshot.checks, None | Some(Checks::Passing));
    if !snapshot.draft && green && snapshot.review != Some(Review::Required) {
        return Need::Ready;
    }
    if !snapshot.draft && snapshot.review == Some(Review::Required) && green {
        return Need::Review;
    }
    if snapshot.checks == Some(Checks::Running) {
        return Need::Running;
    }
    Need::Draft
}

/// Whose turn it is: `working` says its owner's Agent works now, and
/// `auto_fix` that Banda tells it what is new (ADR 0076, decision 4).
pub fn turn(need: Need, snapshot: &Snapshot, auto_fix: bool, working: bool) -> Turn {
    match need {
        Need::Merged | Need::Closed => Turn::Landed,
        _ if working => Turn::Agent,
        Need::Conflicts | Need::Changes | Need::Failing if auto_fix => Turn::Agent,
        Need::Conflicts | Need::Changes | Need::Failing => Turn::Person,
        Need::Ready if snapshot.auto_merge => Turn::Waiting,
        Need::Ready => Turn::Person,
        Need::Review if snapshot.asked_of_you => Turn::Person,
        Need::Review | Need::Running => Turn::Waiting,
        // A draft whose Thread no longer works is the Person's to make
        // ready.
        Need::Draft => Turn::Person,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Counted;

    fn open() -> Snapshot {
        Snapshot {
            state: State::Open,
            draft: false,
            title: "feat: a".into(),
            head: "feat/a".into(),
            base: "main".into(),
            checks: Some(Checks::Passing),
            counted: Counted::default(),
            review: None,
            asked_of_you: false,
            conflicts: false,
            auto_merge: false,
            additions: 1,
            deletions: 0,
            updated_at: 0,
            merged_at: None,
            closed_at: None,
            synced_at: 0,
        }
    }

    #[test]
    fn the_most_urgent_need_wins() {
        let mut pr = open();
        assert_eq!(need(&pr), Need::Ready);
        pr.checks = None;
        assert_eq!(need(&pr), Need::Ready, "no checks is no failure");
        pr.checks = Some(Checks::Running);
        assert_eq!(need(&pr), Need::Running);
        pr.review = Some(Review::Required);
        assert_eq!(need(&pr), Need::Running, "its checks first");
        pr.checks = Some(Checks::Passing);
        assert_eq!(need(&pr), Need::Review);
        pr.checks = Some(Checks::Failing);
        assert_eq!(need(&pr), Need::Failing);
        pr.review = Some(Review::ChangesRequested);
        assert_eq!(need(&pr), Need::Changes);
        pr.conflicts = true;
        assert_eq!(need(&pr), Need::Conflicts);
        pr.state = State::Merged;
        assert_eq!(need(&pr), Need::Merged);
        pr.state = State::Closed;
        assert_eq!(need(&pr), Need::Closed);
    }

    #[test]
    fn a_draft_is_never_ready() {
        let mut pr = open();
        pr.draft = true;
        assert_eq!(need(&pr), Need::Draft);
        pr.checks = Some(Checks::Running);
        assert_eq!(need(&pr), Need::Running);
        pr.checks = Some(Checks::Failing);
        assert_eq!(need(&pr), Need::Failing);
    }

    #[test]
    fn whose_turn_it_is() {
        let mut pr = open();
        assert_eq!(turn(Need::Ready, &pr, true, false), Turn::Person);
        pr.auto_merge = true;
        assert_eq!(turn(Need::Ready, &pr, true, false), Turn::Waiting);
        assert_eq!(turn(Need::Failing, &pr, true, false), Turn::Agent);
        assert_eq!(turn(Need::Failing, &pr, false, false), Turn::Person);
        assert_eq!(turn(Need::Failing, &pr, false, true), Turn::Agent);
        assert_eq!(turn(Need::Review, &pr, true, false), Turn::Waiting);
        pr.asked_of_you = true;
        assert_eq!(turn(Need::Review, &pr, true, false), Turn::Person);
        assert_eq!(turn(Need::Running, &pr, true, false), Turn::Waiting);
        assert_eq!(turn(Need::Draft, &pr, true, true), Turn::Agent);
        assert_eq!(turn(Need::Draft, &pr, true, false), Turn::Person);
        assert_eq!(turn(Need::Merged, &pr, true, true), Turn::Landed);
    }
}
