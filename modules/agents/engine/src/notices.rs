//! A notice another part of Banda posts in a Thread for its Agent
//! (`agents.notice`), as git's card does after a commit the Person made
//! from it: a quiet line the Thread shows at once, which the Agent reads
//! before the message of its next turn, so a commit it did not make is no
//! surprise. It starts no turn.

use crate::model::{Body, Fact, Item, ItemId, ThreadId};
use crate::{emit, store};
use banda_kernel::{Error, Participant, Refusal, Tx};
use serde::Deserialize;
use ts_rs::TS;

/// How long a notice may be, in characters.
pub const NOTICE: usize = 500;

/// What `agents.notice` is asked.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct PostNotice {
    pub thread: ThreadId,
    /// One line: what the Person did, as `Committed 2 files on main: “Add
    /// multiply” (a1b2c3d).`
    pub text: String,
}

/// Posts the notice in its Thread, for its Agent's next prompt.
pub fn post(
    tx: &mut Tx<'_>,
    by: Participant,
    PostNotice { thread, text }: PostNotice,
) -> Result<(), Error> {
    if !matches!(by, Participant::Person(_)) {
        return Err(Refusal::forbidden("Only a Person posts a notice for an Agent.").into());
    }
    let text = text.trim();
    if text.is_empty() || text.contains('\n') {
        return Err(Refusal::invalid("A notice is one line of text.").into());
    }
    if text.chars().count() > NOTICE {
        return Err(Refusal::invalid(format!("A notice is at most {NOTICE} characters.")).into());
    }
    store::thread(tx.sql(), thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?;
    let item = Item {
        id: ItemId::new(),
        turn: None,
        author: by,
        at: tx.now(),
        body: Body::Notice {
            text: text.to_owned(),
        },
    };
    store::insert_item(tx.sql(), thread, &item)?;
    store::set_unsent(tx.sql(), item.id)?;
    let posted = Fact::NoticePosted {
        item: item.id,
        turn: None,
        text: text.to_owned(),
    };
    emit(tx, by, thread, &posted)
}

/// What the Harness reads for `text` with the `notices` its Agent has not
/// read yet before it, so it knows what changed meanwhile and that it
/// asks nothing.
pub fn before(notices: &[String], text: &str) -> String {
    if notices.is_empty() {
        return text.to_owned();
    }
    let lines: Vec<String> = notices.iter().map(|n| format!("- {n}")).collect();
    format!(
        "Since your last turn, your Person did this in Banda, outside this conversation; \
         it is no request:\n{}\n\n{text}",
        lines.join("\n")
    )
}

/// Whether a turn's message takes the notices along: a slash command goes
/// as it is, for the Harness to run, and they wait for the next.
pub fn takes(text: &str) -> bool {
    !text.starts_with('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_go_before_the_message_and_none_leave_it_as_it_is() {
        assert_eq!(before(&[], "hello"), "hello");
        let said = before(
            &["Committed 1 file on main: “A” (abc1234).".into()],
            "go on",
        );
        assert!(said.starts_with("Since your last turn, your Person did this in Banda"));
        assert!(said.ends_with(":\n- Committed 1 file on main: “A” (abc1234).\n\ngo on"));
        assert!(!takes("/compact"));
        assert!(takes("compact"));
    }
}
