//! A Thread moves to another account of its Harness (ADR 0078, decision 4):
//! `agents.switch` names the Harness entry it runs on from its next turn.
//! The turn that runs ends on the account it began on. The next one opens
//! the same session on the new account's process, whose sessions are kept
//! where every account of the Harness reads them; the old process lets go
//! of the Thread's (`Live::forget_elsewhere`).

use crate::model::{Fact, ThreadId};
use crate::{emit, store};
use banda_kernel::{Error, Participant, Refusal, Tx};

/// Moves `thread` from the entry `was`, as the caller found it, to
/// `harness`. A Thread already there writes nothing; one that moved
/// meanwhile is refused, so two windows do not cross.
pub fn switch(
    tx: &mut Tx<'_>,
    author: Participant,
    thread: ThreadId,
    was: String,
    harness: String,
) -> Result<(), Error> {
    let now = store::thread(tx.sql(), thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?
        .harness;
    if now == harness {
        return Ok(());
    }
    if now != was {
        return Err(Refusal::conflict("The Thread moved to another account meanwhile.").into());
    }
    store::switch(tx.sql(), thread, &harness)?;
    let fact = Fact::ThreadSwitched {
        thread,
        harness,
        was,
    };
    emit(tx, author, thread, &fact)
}
