//! Notices for a Thread's Agent of what another module did for its
//! Person, as git's after a commit from the Thread's card: a quiet line
//! the Thread shows at once, which the Agent reads before the next
//! message it gets, so a commit it did not make is no surprise. It starts
//! no turn. Git says them as its facts `git.acted`, which this hears.

use crate::model::ThreadId;
use crate::notes::one_line;
use crate::{store, transcript};
use banda_kernel::{Error, EventFilter, Heard, Participant, Tx};

/// How long a notice may be, in characters.
pub const NOTICE: usize = 500;

/// What the module hears from git: a step its card asked for was done.
pub fn heard() -> EventFilter {
    EventFilter {
        module: Some("git".into()),
        subject: None,
        kinds: Some(vec!["git.acted".into()]),
    }
}

/// Posts each notice git tells of in its Thread, one at a time, until the
/// Space is gone.
pub async fn follow(mut heard: Heard) {
    loop {
        let event = match heard.next().await {
            Ok(Some(event)) => event,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(%error, "the Threads stopped hearing git");
                return;
            }
        };
        let Some(space) = heard.space() else { return };
        let thread = event.payload["thread"]
            .as_str()
            .and_then(|t| t.parse().ok());
        let text = event.payload["notice"].as_str().map(str::to_owned);
        let (Some(thread), Some(text)) = (thread, text) else {
            continue;
        };
        let by = event.author;
        if let Err(error) = space.write(move |tx| post(tx, by, thread, &text)).await {
            tracing::warn!(%error, "a notice for the Agent was not posted");
        }
    }
}

/// Posts `text` in `thread`, for its Agent's next prompt; nothing in a
/// Thread that is not there.
pub fn post(tx: &mut Tx<'_>, by: Participant, thread: ThreadId, text: &str) -> Result<(), Error> {
    let text = one_line(text, NOTICE, "notice")?;
    if store::thread(tx.sql(), thread)?.is_none() {
        return Ok(());
    }
    let item = transcript::notice(tx, by, thread, None, text.to_owned())?;
    store::keep_notice(tx.sql(), thread, item)
}

/// What the Harness reads for `text` with the `notices` its message takes
/// before it, so it knows what changed meanwhile and that it asks nothing.
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
    }
}
