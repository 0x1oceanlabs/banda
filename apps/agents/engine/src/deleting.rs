//! A Thread deleted for good (ADR 0098, decision 14): its Person deletes it
//! from Archive, after a confirmation, and it leaves the Project. Its rows
//! go from the module's tables in one transaction with one fact,
//! `thread.deleted`, which every list drops it on and git lets go of its
//! checkpoints on. The Project's log keeps what the Thread said, as after a
//! rewind, since the log is never rewritten (ADR 0002, decision 6).
//!
//! A Thread has no git worktree of its own yet (ADR 0034: later), so no
//! folder goes: the Project's stays, and so does a scratch Thread's, as
//! Banda deletes no folder it made by itself (ADR 0046, decision 5).

use crate::images::Images;
use crate::live::Live;
use crate::model::{Fact, ThreadId, TurnState};
use crate::rules::Event;
use crate::rules::archive::may_delete;
use crate::visuals::Visuals;
use crate::{emit, marks, store, sweep, sweep_visuals, writer};
use banda_kernel::{Error, ModuleProject, Participant, Refusal, Tx};
use std::sync::Arc;

/// Deletes `thread`, as `author` asks from Archive. One that left Archive
/// since, one at work, or one that asks, is refused, as the confirmation
/// was for none of them; one not there is not found.
pub fn delete(tx: &mut Tx<'_>, author: Participant, thread: ThreadId) -> Result<(), Error> {
    let changed = store::thread(tx.sql(), thread)?
        .ok_or_else(|| Refusal::not_found("There is no such Thread."))?
        .updated_at;
    let (works, asks) = marks::state(tx.sql(), thread)?;
    may_delete(store::archived(tx.sql(), thread)?, changed, works, asks)?;
    // What waits in it, as in a queue held since a stop, is taken back
    // first, as a withdraw takes it, so a message another Thread's Agent
    // wrote answers that Thread while this one is there still (ADR 0019).
    for waiting in store::turns_in(tx.sql(), thread, TurnState::Queued)? {
        writer::apply(tx, author, &waiting, Event::Withdraw)??;
    }
    store::delete_thread(tx.sql(), thread)?;
    emit(tx, author, thread, &Fact::ThreadDeleted { thread })
}

/// Lets go, in the background, of what the engine holds of a deleted
/// `thread` outside its tables, as the delete waits on none of it: its
/// session in each Harness process of `project`, which a Harness may take
/// a while to close, and, with the sweeps, the files of its images and
/// Visuals that no other Thread shows.
pub fn let_go(live: &Arc<Live>, project: &ModuleProject, thread: ThreadId) {
    let (live, id) = (live.clone(), project.id());
    tokio::spawn(async move { live.forget_thread(id, thread).await });
    let data = project.data();
    tokio::spawn(sweep(project.clone(), Images::of(data)));
    tokio::spawn(sweep_visuals(project.clone(), Visuals::of(data)));
}
