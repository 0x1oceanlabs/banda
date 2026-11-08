//! How the log is heard: in order from a place in it, with no gap and no
//! repeat ([`Heard`]), by a window's subscription or by a module's durable
//! [`Listener`], whose place the kernel keeps (ADR 0082, decision 6; A5 of
//! the architecture vision).
//!
//! A module hears the log only through a listener it names
//! ([`ModuleProject::listen`]). The kernel keeps how far each has heard,
//! its cursor, in `kernel_cursors`, and it resumes from there, never from
//! the log's head: a crash loses no fact.
//!
//! - A cursor is kept in the store of the log it reads, beside that log,
//!   so a Project's cursors move with it. `source_scope` names that log's
//!   scope, and a cursor is read only against it. A listener new to a log
//!   starts at its head: what came before is history it was not there for,
//!   unless its module carries a cursor it kept itself
//!   ([`ModuleProject::listen_from`]). One name is one listener: a second
//!   that hears the same log under it, while the first does, is refused.
//! - In one scope, a reaction acks its fact in the transaction that writes
//!   what it does ([`Tx::ack`]): it runs exactly once. A fact acked
//!   already is refused, and the change it came with is not kept.
//! - A reaction whose work is outside the store, as git's checkpoints, or
//!   kept by a key of its own, acks once it is done
//!   ([`Listener::ack_through`]): it may run again after a crash, so it
//!   looks before it acts, and what it does is done once.
//! - Across scopes, as a Project's module hears this machine's log
//!   ([`ModuleProject::listen_to_machine`]), the cursor and what the
//!   reaction writes are in two stores. The reaction writes under the
//!   receipt of the command `CommandId::derive(listener, event)`, and the
//!   cursor moves after ([`Listener::once`]): heard again after a crash
//!   between the two, the receipt answers, and nothing is written again.
//! - A listener says how far it has handled the log, so an effect that
//!   waits for the reactions ([`ModuleProject::reacted`]) waits for it:
//!   asking for the next fact, it has handled the one before.
//!
//! [`ModuleProject::listen`]: crate::ModuleProject::listen
//! [`ModuleProject::listen_from`]: crate::ModuleProject::listen_from
//! [`ModuleProject::listen_to_machine`]: crate::ModuleProject::listen_to_machine
//! [`ModuleProject::reacted`]: crate::ModuleProject::reacted
//! [`Tx::ack`]: crate::Tx::ack

use crate::events::{self, Event, EventFilter};
use crate::project::{ModuleProject, Project};
use crate::store::{KERNEL, Receipt};
use crate::{CommandId, Error, ProjectId, Refusal, Tx, now_ms};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::VecDeque;
use std::sync::{Arc, Weak};
use tokio::sync::{broadcast, watch};

/// How many events one read of the log takes.
const PAGE: usize = 500;

/// The longest name a module gives a listener.
const NAME: usize = 64;

/// Where a module's listener keeps its place: who listens, and in which
/// log.
pub(crate) struct Cursor {
    module: &'static str,
    /// Its row in `kernel_cursors`: `<module>.<name>`, with `@<Project>`
    /// for a Project's module that hears this machine's log.
    key: String,
    /// The scope whose log it hears, where its cursor is.
    source: ProjectId,
    /// The Project of the module that listens, when it hears another
    /// scope's log: what its reaction writes goes there.
    home: Option<Weak<Project>>,
}

impl Cursor {
    /// `module`'s listener `name` of the log of `source`; `home` is the
    /// module's own Project when that log is another scope's.
    pub(crate) fn new(
        module: &'static str,
        name: &str,
        source: ProjectId,
        home: Option<&Arc<Project>>,
    ) -> Result<Cursor, Refusal> {
        let plain = !name.is_empty()
            && name.len() <= NAME
            && (name.bytes()).all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !plain {
            return Err(Refusal::invalid(format!(
                "A listener's name is 1 to {NAME} lowercase letters, digits and dashes, not \"{name}\"."
            )));
        }
        let key = match home {
            Some(home) => format!("{module}.{name}@{}", home.id()),
            None => format!("{module}.{name}"),
        };
        Ok(Cursor {
            module,
            key,
            source,
            home: home.map(Arc::downgrade),
        })
    }
}

/// What acks one fact in the transaction of the reaction to it, in the
/// scope of its log: [`Tx::ack`](crate::Tx::ack).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ack {
    module: &'static str,
    listener: String,
    source: ProjectId,
    /// None for a fact its listener had not given.
    seq: Option<i64>,
}

/// Where `listener` stands in the log of `source`, kept from before or
/// begun now: at `carried`, a cursor its module kept itself before, or
/// else at the log's head, and never past it. Says the head too.
fn begun(
    sql: &Connection,
    listener: &str,
    source: ProjectId,
    carried: Option<i64>,
) -> Result<(i64, i64), Error> {
    let head = events::head(sql)?;
    let at = carried.map_or(head, |carried| carried.clamp(0, head));
    sql.execute(
        "INSERT INTO kernel_cursors (listener, source_scope, seq, at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (listener, source_scope) DO NOTHING",
        params![listener, source, at, now_ms()],
    )?;
    let at = sql.query_row(
        "SELECT seq FROM kernel_cursors WHERE listener = ?1 AND source_scope = ?2",
        params![listener, source],
        |row| row.get(0),
    )?;
    Ok((at, head))
}

/// Moves `listener`'s cursor in the log of `source` on to `seq`; says
/// whether it moved, which it does not when it stands there or past it,
/// or has no row here.
fn moved(sql: &Connection, listener: &str, source: ProjectId, seq: i64) -> Result<bool, Error> {
    let moved = sql.execute(
        "UPDATE kernel_cursors SET seq = ?3, at = ?4
         WHERE listener = ?1 AND source_scope = ?2 AND seq < ?3",
        params![listener, source, seq, now_ms()],
    )?;
    Ok(moved == 1)
}

/// Acks `ack`'s fact, in a transaction of `module` on its log's store.
/// Refused as `conflict` when it was acked already: its reaction ran.
pub(crate) fn ack(sql: &Connection, module: &str, ack: &Ack) -> Result<(), Error> {
    if ack.module != module {
        return Err(Refusal::invalid("A module acks only what its own listeners heard.").into());
    }
    let Some(seq) = ack.seq else {
        return Err(unheard().into());
    };
    if moved(sql, &ack.listener, ack.source, seq)? {
        return Ok(());
    }
    let kept = sql
        .query_row(
            "SELECT seq FROM kernel_cursors WHERE listener = ?1 AND source_scope = ?2",
            params![ack.listener, ack.source],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    Err(match kept {
        Some(_) => Refusal::conflict("This fact was heard already: its reaction ran."),
        None => Refusal::invalid(
            "This listener's cursor is in another scope: its reaction writes through `Listener::once`.",
        ),
    }
    .into())
}

fn unheard() -> Refusal {
    Refusal::invalid("A listener acks only what it has heard.")
}

/// Lets go of the cursors `home`'s modules kept in this machine's log, as
/// that Project is removed: none of them hears it again.
pub(crate) async fn forget(machine: &Project, home: ProjectId) -> Result<(), Error> {
    let of = format!("@{home}");
    let forget = move |tx: &mut Tx<'_>| {
        tx.kernel().execute(
            "DELETE FROM kernel_cursors WHERE substr(listener, -length(?1)) = ?1",
            [&of],
        )?;
        Ok(())
    };
    machine.store().write(KERNEL, forget).await
}

/// Events of any module as they are committed, from a place in the log
/// on: a window's subscription, or what a module's [`Listener`] hears. It
/// holds the Project only while it reads the log, so a removed Project
/// still goes.
pub(crate) struct Heard {
    project: Weak<Project>,
    live: broadcast::Receiver<Arc<Event>>,
    filter: EventFilter,
    /// The last event heard.
    last: i64,
    /// The last event given.
    given: i64,
    /// The log's head as it began: what came up to there, it hears late.
    began: i64,
    /// Where a listener says how far it has handled the log.
    handled: Option<watch::Sender<i64>>,
    /// Read from the log and not yet given.
    read: VecDeque<Event>,
    /// The log is read up to the live events.
    caught_up: bool,
    /// Whether the Project of the module that listens is open, when it
    /// hears another's log: it ends as that Project closes. A watch, not
    /// that Project's log, which would wake it at each of its events.
    from: Option<watch::Receiver<()>>,
}

impl Heard {
    /// The events of `project`'s log after `after` that match `filter`, as
    /// a window's subscription hears them. Listening before the log is
    /// read, nothing falls between the two.
    pub(crate) fn new(project: &Arc<Project>, after: i64, filter: EventFilter) -> Heard {
        Heard {
            project: Arc::downgrade(project),
            live: project.subscribe(),
            filter,
            last: after,
            given: after,
            began: after,
            handled: None,
            read: VecDeque::new(),
            caught_up: false,
            from: None,
        }
    }

    /// The next event, in the log's order; none once the Project is gone.
    /// Falling behind the live events, it reads the log again, so none is
    /// missed. Asking for the next says the last one given is handled.
    pub(crate) async fn next(&mut self) -> Result<Option<Event>, Error> {
        self.reacted(self.given);
        loop {
            if self
                .from
                .as_ref()
                .is_some_and(|from| from.has_changed().is_err())
            {
                return Ok(self.end());
            }
            if let Some(event) = self.read.pop_front() {
                self.given = event.seq;
                return Ok(Some(event));
            }
            if !self.caught_up {
                let Some(project) = self.project.upgrade() else {
                    return Ok(None);
                };
                let page = project
                    .events_after(self.last, self.filter.clone(), PAGE)
                    .await?;
                self.caught_up = page.len() < PAGE;
                if let Some(last) = page.last() {
                    self.last = last.seq;
                }
                // Read after the head it began at, a short page holds all
                // it had to hear up to there.
                if self.caught_up {
                    self.last = self.last.max(self.began);
                }
                self.read.extend(page);
                continue;
            }
            // Everything up to the last heard is handled: the log's events
            // were given, and the others are not its to react to.
            self.reacted(self.last);
            let heard = match &mut self.from {
                Some(from) => tokio::select! {
                    heard = self.live.recv() => heard,
                    _ = from.changed() => return Ok(self.end()),
                },
                None => self.live.recv().await,
            };
            match heard {
                Ok(event) if event.seq > self.last => {
                    self.last = event.seq;
                    if self.filter.matches(&event) {
                        self.given = event.seq;
                        return Ok(Some(Event::clone(&event)));
                    }
                }
                Ok(_) => {}
                // Back to the log for what went by.
                Err(broadcast::error::RecvError::Lagged(_)) => self.caught_up = false,
                Err(broadcast::error::RecvError::Closed) => return Ok(None),
            }
        }
    }

    /// Its hearing Project closed: it reacts no more, so no one waits on it.
    fn end(&mut self) -> Option<Event> {
        self.handled = None;
        None
    }

    /// Says it has reacted to every event up to `seq`.
    fn reacted(&self, seq: i64) {
        if let Some(handled) = &self.handled {
            handled.send_if_modified(|was| {
                let further = seq > *was;
                if further {
                    *was = seq;
                }
                further
            });
        }
    }
}

/// A module's durable listener of a log: the events of any module that
/// match its filter, from where it last acked, each once it is committed
/// (ADR 0082, decision 6). See [`ModuleProject::listen`].
///
/// [`ModuleProject::listen`]: crate::ModuleProject::listen
pub struct Listener {
    heard: Heard,
    cursor: Cursor,
}

impl Listener {
    /// `cursor`'s listener of `source`'s log, its events that match
    /// `filter` from its cursor on, begun at `carried` or the head if it
    /// has none. The effects that wait for the reactions to `source`'s log
    /// wait for it. With `from`, it ends as the Project of the module that
    /// listens closes. Refused while another listener of `source` hears
    /// it under the same name.
    pub(crate) async fn begin(
        source: &Arc<Project>,
        cursor: Cursor,
        filter: EventFilter,
        carried: Option<i64>,
        from: Option<watch::Receiver<()>>,
    ) -> Result<Listener, Error> {
        let (key, of) = (cursor.key.clone(), cursor.source);
        let begin = move |tx: &mut Tx<'_>| begun(&tx.kernel(), &key, of, carried);
        let (after, head) = source.store().write(KERNEL, begin).await?;
        let handled = source.listening(&cursor.key, after, from.clone())?;
        let heard = Heard {
            began: head,
            handled: Some(handled),
            from,
            ..Heard::new(source, after, filter)
        };
        Ok(Listener { heard, cursor })
    }

    /// The next event, in the log's order; none once the Project whose
    /// log it hears is gone, or the one of the module that listens.
    /// Asking for the next says the last one given is handled.
    pub async fn next(&mut self) -> Result<Option<Event>, Error> {
        self.heard.next().await
    }

    /// The Project of the module that listens, while it is open, as that
    /// module sees it: where its reaction writes.
    pub fn project(&self) -> Option<ModuleProject> {
        Some(self.home()?.module(self.cursor.module))
    }

    /// Where its reaction writes, while it is open: its module's own
    /// Project, or else the one whose log it hears.
    fn home(&self) -> Option<Arc<Project>> {
        match &self.cursor.home {
            Some(home) => home.upgrade(),
            None => self.heard.project.upgrade(),
        }
    }

    /// Whether `event` was committed before this listener began: its
    /// module was not there as it came, and hears it late, catching up.
    pub fn late(&self, event: &Event) -> bool {
        event.seq <= self.heard.began
    }

    /// What acks `event` in the transaction that writes the reaction to
    /// it: `tx.ack(&listener.ack(&event))` in a change of the listener's
    /// module, in the scope of the log it hears. Its reaction runs exactly
    /// once. One for a fact it has not given yet is refused. Across
    /// scopes, [`Listener::once`] writes it.
    pub fn ack(&self, event: &Event) -> Ack {
        Ack {
            module: self.cursor.module,
            listener: self.cursor.key.clone(),
            source: self.cursor.source,
            seq: (event.seq <= self.heard.given).then_some(event.seq),
        }
    }

    /// Acks, by itself, every fact up to `seq`: after a reaction whose work
    /// is outside the store, as git's checkpoints, or kept by a key of its
    /// own, as pulls' links. A crash before it, and the reaction runs
    /// again, so it looks before it acts. A cursor at or past `seq` stays;
    /// one past what it has given is refused.
    pub async fn ack_through(&self, seq: i64) -> Result<(), Error> {
        if seq > self.heard.given {
            return Err(unheard().into());
        }
        let Some(source) = self.heard.project.upgrade() else {
            return Err(Error::Closed);
        };
        let (key, of) = (self.cursor.key.clone(), self.cursor.source);
        let through = move |tx: &mut Tx<'_>| moved(&tx.kernel(), &key, of, seq).map(drop);
        source.store().write(KERNEL, through).await
    }

    /// The reaction to `event` of a listener of another scope's log:
    /// `change`, written in the listener's own Project under the receipt
    /// of the command `CommandId::derive(listener, event)`, then the
    /// cursor acked (ADR 0082, decision 4). Heard again after a crash
    /// between the two, the receipt answers, and `change` does not run:
    /// none. A listener of its own scope's log acks in its reaction's
    /// transaction instead ([`Listener::ack`]), and is refused here.
    ///
    /// Its limits: the receipt is kept thirty days, as a command's, so a
    /// crash between the two and that Project closed past them, and the
    /// change runs again. And as the two stores sync each on its own, a
    /// power cut just after may keep the cursor's move and lose the change.
    pub async fn once<T: Send + 'static>(
        &self,
        event: &Event,
        change: impl FnOnce(&mut Tx<'_>) -> Result<T, Error> + Send + 'static,
    ) -> Result<Option<T>, Error> {
        if self.cursor.home.is_none() {
            let own = "A listener of its own scope's log acks in its reaction's transaction.";
            return Err(Refusal::invalid(own).into());
        }
        if event.seq > self.heard.given {
            return Err(unheard().into());
        }
        let home = self.home().ok_or(Error::Closed)?;
        let receipt = Receipt {
            command: CommandId::derive(&self.cursor.key, &event.id.to_string()),
            module: self.cursor.module,
            method: self.cursor.key.clone(),
            author: event.author,
            params: Receipt::hash(&serde_json::json!(event.id)),
        };
        let written = home.store().write(self.cursor.module, move |tx| {
            if receipt.ran(&tx.kernel())? {
                return Ok(None);
            }
            let value = change(tx)?;
            receipt.ran_now(&tx.kernel())?;
            Ok(Some(value))
        });
        let written = written.await?;
        drop(home);
        self.ack_through(event.seq).await?;
        Ok(written)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_listener_is_named_plainly() {
        let source = ProjectId::new();
        let own = Cursor::new("notes", "copies", source, None).unwrap();
        assert_eq!(own.key, "notes.copies");
        for bad in ["", "A", "a.b", "a@b", "a b", &"a".repeat(NAME + 1)] {
            assert!(Cursor::new("notes", bad, source, None).is_err(), "{bad}");
        }
    }
}
