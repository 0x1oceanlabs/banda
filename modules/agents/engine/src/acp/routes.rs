//! Where what each session says goes: to the turn whose prompt it
//! answers, or else to whoever hears the session between turns.

use super::*;

/// What a session says while none of the engine's turns runs in it.
pub enum Between {
    /// The Harness said it by itself, as Claude Code does when it goes on
    /// with what a background task it started found.
    Said(Said),
    /// A turn's prompt went to the session: what it says now is the turn's.
    Prompted,
}

/// Each session's listeners, by the session.
#[derive(Clone, Default)]
pub(super) struct Routes {
    turns: Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Said>>>>,
    between: Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<Between>>>>,
}

#[derive(Clone)]
pub(super) enum Route {
    Turn(mpsc::UnboundedSender<Said>),
    Between(mpsc::UnboundedSender<Between>),
}

impl Routes {
    pub(super) fn of(&self, session: &acp::SessionId) -> Option<Route> {
        if let Some(turn) = self.turns.lock().unwrap().get(session) {
            return Some(Route::Turn(turn.clone()));
        }
        let between = self.between.lock().unwrap();
        between.get(session).cloned().map(Route::Between)
    }

    /// A turn's prompt goes to `session`: what it says from now on is the
    /// turn's, and whoever hears it between turns hears that.
    pub(super) fn prompt(&self, session: &acp::SessionId) -> mpsc::UnboundedReceiver<Said> {
        let (said, hear) = mpsc::unbounded_channel();
        self.turns.lock().unwrap().insert(session.clone(), said);
        if let Some(between) = self.between.lock().unwrap().get(session) {
            let _ = between.send(Between::Prompted);
        }
        hear
    }

    /// The turn's prompt in `session` was answered: what the session says
    /// now is no turn's.
    pub(super) fn ended(&self, session: &acp::SessionId) {
        self.turns.lock().unwrap().remove(session);
    }

    /// A closed session: nothing goes to it any more.
    pub(super) fn forget(&self, session: &acp::SessionId) {
        self.ended(session);
        self.between.lock().unwrap().remove(session);
    }

    /// Whether a turn's prompt runs in `session` now.
    pub(super) fn prompting(&self, session: &acp::SessionId) -> bool {
        self.turns.lock().unwrap().contains_key(session)
    }

    /// Whether a turn's prompt runs in any session.
    pub(super) fn busy(&self) -> bool {
        !self.turns.lock().unwrap().is_empty()
    }

    /// Hears what `session` says between turns, from now on; `None` while
    /// someone already hears it.
    pub(super) fn hear(
        &self,
        session: &acp::SessionId,
    ) -> Option<mpsc::UnboundedReceiver<Between>> {
        let mut between = self.between.lock().unwrap();
        if between.get(session).is_some_and(|heard| !heard.is_closed()) {
            return None;
        }
        let (said, hear) = mpsc::unbounded_channel();
        between.insert(session.clone(), said);
        Some(hear)
    }

    /// Everyone who listens hears that the Harness is gone.
    pub(super) fn clear(&self) {
        self.turns.lock().unwrap().clear();
        self.between.lock().unwrap().clear();
    }
}

impl Route {
    /// False when nobody listens any more.
    pub(super) fn send(&self, said: Said) -> bool {
        match self {
            Route::Turn(turn) => turn.send(said).is_ok(),
            Route::Between(between) => between.send(Between::Said(said)).is_ok(),
        }
    }
}
