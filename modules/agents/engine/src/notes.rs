//! What a Thread's Agent tells its Person when its turn ends (ADR 0057):
//! a line the turn keeps, which its `done` call says in the toast, the
//! system notification and the bell. It tells nothing by itself.

use crate::store;
use banda_kernel::{AgentId, Error, Refusal, Tx};
use schemars::JsonSchema;
use serde::Deserialize;
use ts_rs::TS;

/// How long a note may be, in characters: a toast's two lines.
pub const NOTE: usize = 140;

/// What `notify` tells the Agent.
pub const NOTED: &str = "Kept: your Person sees it when this turn ends, where they \
will notice it, and not while they look at your Thread. Don't repeat it in your reply.";

/// What the Agent tells its Person.
#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "agents/")]
pub struct Notify {
    /// One line, at most 140 characters: what is done, or what you need
    /// of your Person.
    pub text: String,
}

/// Keeps the note on the Agent's turn that runs, in place of one it kept.
pub fn note(tx: &mut Tx<'_>, agent: AgentId, Notify { text }: Notify) -> Result<(), Error> {
    let text = text.trim();
    if text.is_empty() || text.contains('\n') {
        return Err(Refusal::invalid("A note is one line of text.").into());
    }
    if text.chars().count() > NOTE {
        return Err(Refusal::invalid(format!("A note is at most {NOTE} characters.")).into());
    }
    let thread = crate::rules::to_thread::own_thread(store::thread_of(tx.sql(), agent)?)?;
    let turn = store::running(tx.sql(), thread)?
        .ok_or_else(|| Refusal::conflict("A note is kept in a turn that runs."))?;
    store::set_note(tx.sql(), turn.id, text)
}
