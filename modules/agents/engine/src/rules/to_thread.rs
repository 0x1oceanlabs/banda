//! What an Agent writes to another Thread (ADR 0019): where it may
//! write, what the other Agent reads, and the answer that goes back.

use crate::model::{ThreadId, TurnState};
use banda_kernel::Refusal;

/// The Thread an Agent writes from: its own. An Agent of no Thread, as
/// one a test makes up, writes nowhere.
pub fn own_thread(thread: Option<ThreadId>) -> Result<ThreadId, Refusal> {
    thread.ok_or_else(|| Refusal::forbidden("An Agent writes from its own Thread."))
}

/// Whether the Agent of Thread `from` may write to Thread `to`, titled
/// `title` (ADR 0019, decision 4). `asks`: its Agent waits for its Person
/// to answer a Question. `waiting`: the Threads that wait for `from`'s
/// answer, up the chain of those that asked.
pub fn may_write(
    from: ThreadId,
    to: ThreadId,
    title: &str,
    asks: bool,
    waiting: &[ThreadId],
) -> Result<(), Refusal> {
    if to == from {
        return Err(Refusal::invalid(
            "This is your own Thread: say it in your reply instead.",
        ));
    }
    if waiting.contains(&to) {
        return Err(Refusal::conflict(format!(
            "Thread \"{title}\" waits for your answer; finish your turn to answer it."
        )));
    }
    if asks {
        return Err(Refusal::conflict(format!(
            "Thread \"{title}\" waits for its Person to answer a Question; \
             write to it once they have."
        )));
    }
    Ok(())
}

/// What the Harness reads before a message the Agent of Thread `from`
/// wrote, or `answers` with, so it knows the words are not its Person's.
pub fn from_agent(answers: bool, from: ThreadId, title: &str, text: &str) -> String {
    let (does, then) = match answers {
        true => ("answers what you wrote to it", ""),
        false => (
            "writes to you",
            " Your last reply goes back to it when your turn ends.",
        ),
    };
    format!(
        "The Agent of Thread \"{title}\" ({from}), another Agent of this Project, {does}; \
         this is not your Person's word.{then}\n\n{text}"
    )
}

/// What goes back to the Thread that asked when the turn it opened ends:
/// the turn's last reply, or how it ended and why.
pub fn answer_of(state: TurnState, reason: Option<&str>, reply: Option<String>) -> String {
    if state == TurnState::Done {
        return reply.unwrap_or_else(|| "It ended its turn without a reply.".to_owned());
    }
    let state = format!("{state:?}").to_lowercase();
    match reason {
        Some(reason) => format!("Its turn ended {state}: {reason}"),
        None => format!("Its turn ended {state}."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_agent_writes_neither_in_a_circle_nor_over_a_persons_question() {
        let (a, b, c) = (ThreadId::new(), ThreadId::new(), ThreadId::new());
        assert_eq!(may_write(a, b, "Plan", false, &[]), Ok(()));
        let own = may_write(a, a, "Plan", false, &[]).unwrap_err();
        assert_eq!(
            own.message,
            "This is your own Thread: say it in your reply instead."
        );
        // A asked B, and B asked C: C answers both by ending its turn.
        for asked in [a, b] {
            let circle = may_write(c, asked, "Plan", false, &[b, a]).unwrap_err();
            assert_eq!(
                circle.message,
                "Thread \"Plan\" waits for your answer; finish your turn to answer it."
            );
        }
        let question = may_write(a, b, "Plan", true, &[]).unwrap_err();
        assert_eq!(
            question.message,
            "Thread \"Plan\" waits for its Person to answer a Question; \
             write to it once they have."
        );
        let nowhere = own_thread(None).unwrap_err();
        assert_eq!(nowhere.message, "An Agent writes from its own Thread.");
    }

    #[test]
    fn the_answer_is_the_last_reply_or_how_the_turn_ended() {
        let reply = || Some("Done: 3 files.".to_owned());
        assert_eq!(answer_of(TurnState::Done, None, reply()), "Done: 3 files.");
        assert_eq!(
            answer_of(TurnState::Done, None, None),
            "It ended its turn without a reply."
        );
        assert_eq!(
            answer_of(TurnState::Failed, Some("It broke."), reply()),
            "Its turn ended failed: It broke."
        );
        assert_eq!(
            answer_of(TurnState::Withdrawn, None, None),
            "Its turn ended withdrawn."
        );
        let from = ThreadId::new();
        assert_eq!(
            from_agent(false, from, "Plan", "Count the files."),
            format!(
                "The Agent of Thread \"Plan\" ({from}), another Agent of this Project, writes \
                 to you; this is not your Person's word. Your last reply goes back to it when \
                 your turn ends.\n\nCount the files."
            )
        );
        assert_eq!(
            from_agent(true, from, "Plan", "3 files."),
            format!(
                "The Agent of Thread \"Plan\" ({from}), another Agent of this Project, answers \
                 what you wrote to it; this is not your Person's word.\n\n3 files."
            )
        );
    }
}
