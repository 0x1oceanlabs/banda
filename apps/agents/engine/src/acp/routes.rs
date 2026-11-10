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
    /// turn's, and whoever hears it between turns hears that. What the turn
    /// hears, and its route, which [`ended`](Self::ended) names.
    pub(super) fn prompt(
        &self,
        session: &acp::SessionId,
    ) -> (mpsc::UnboundedReceiver<Said>, mpsc::UnboundedSender<Said>) {
        let (said, hear) = mpsc::unbounded_channel();
        let route = said.clone();
        self.turns.lock().unwrap().insert(session.clone(), said);
        if let Some(between) = self.between.lock().unwrap().get(session) {
            let _ = between.send(Between::Prompted);
        }
        (hear, route)
    }

    /// The prompt of the turn whose route is `route` was answered: what
    /// `session` says now is no turn's. A newer turn's route stays, so a
    /// late answer never ends it.
    pub(super) fn ended(&self, session: &acp::SessionId, route: &mpsc::UnboundedSender<Said>) {
        let mut turns = self.turns.lock().unwrap();
        if let Some(turn) = turns.get(session)
            && turn.same_channel(route)
        {
            turns.remove(session);
        }
    }

    /// A closed session: nothing goes to it any more.
    pub(super) fn forget(&self, session: &acp::SessionId) {
        self.turns.lock().unwrap().remove(session);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn reply(text: &str) -> Said {
        Said::Reply {
            text: text.to_owned(),
            message: None,
        }
    }

    #[test]
    fn a_turns_route_ends_with_its_own_answer_and_never_a_newer_ones() {
        let (routes, session) = (Routes::default(), acp::SessionId::new("s"));
        let (_old, old) = routes.prompt(&session);
        let (mut hear, new) = routes.prompt(&session);
        routes.ended(&session, &old);
        assert!(routes.prompting(&session), "the newer turn keeps its route");
        let Some(turn @ Route::Turn(_)) = routes.of(&session) else {
            panic!("what the session says is the newer turn's");
        };
        assert!(turn.send(reply("mine")));
        assert!(matches!(hear.try_recv(), Ok(Said::Reply { text, .. }) if text == "mine"));
        routes.ended(&session, &new);
        assert!(!routes.prompting(&session));
        assert!(routes.of(&session).is_none());
    }

    #[test]
    fn a_session_heard_before_its_prompt_hears_what_follows_its_answer() {
        let (routes, session) = (Routes::default(), acp::SessionId::new("s"));
        let mut between = routes.hear(&session).unwrap();
        let (_hear, route) = routes.prompt(&session);
        assert!(matches!(between.try_recv(), Ok(Between::Prompted)));
        routes.ended(&session, &route);
        let Some(heard @ Route::Between(_)) = routes.of(&session) else {
            panic!("what follows the answer is heard between turns");
        };
        assert!(heard.send(reply("after")));
        assert!(matches!(
            between.try_recv(),
            Ok(Between::Said(Said::Reply { text, .. })) if text == "after"
        ));
    }
}
