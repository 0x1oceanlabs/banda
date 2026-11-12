//! Where what each session says goes: to the turn whose prompt it
//! answers, or else to whoever hears the session between turns; and what
//! a Thread's sub-agents say, on their child sessions, to whoever hears
//! the lanes of the Thread's session (ADR 0103, decision 7).
//!
//! A child is taken only from a session Banda listens to: a Thread's
//! session whose lanes are heard, or a child it has already. It is kept
//! after it goes idle, as late frames and a resumed child still come on
//! it, until its root session closes or the Harness is gone.

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
    /// Each sub-agent's child session, as it was announced.
    children: Arc<Mutex<HashMap<acp::SessionId, Child>>>,
    /// Whoever hears the lanes of each Thread's session, the root.
    lanes: Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<LaneSaid>>>>,
    /// The messages between sessions, as far as they came, by the session
    /// they came on and their ID there.
    messages: Arc<Mutex<HashMap<(acp::SessionId, String), Message>>>,
    /// Whoever hears the Crews of each Thread's session (ADR 0103,
    /// decision 9).
    crews: Arc<Mutex<HashMap<acp::SessionId, mpsc::UnboundedSender<CrewSaid>>>>,
    /// What goes on in the background of each Thread's session, as Claude
    /// last listed it.
    background: Arc<Mutex<HashMap<acp::SessionId, Vec<Background>>>>,
    /// What Claude's raw frames tie each sub-agent to, by its root session
    /// and the tool use that launched it.
    ties: Arc<Mutex<HashMap<(acp::SessionId, String), Tie>>>,
}

/// A sub-agent's child session, as Banda maps it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Child {
    /// The Thread's session it works under, whose lanes hear it.
    pub(super) root: acp::SessionId,
    /// The Harness lets a client stop it alone.
    pub(super) cancel: bool,
    /// The message its parent sent it first, its brief, once one came.
    pub(super) brief: Option<String>,
}

/// A message between sessions, as far as it came.
#[derive(Clone, Default)]
pub(super) struct Message {
    pub(super) sender: Option<acp::SessionId>,
    pub(super) recipient: Option<acp::SessionId>,
    pub(super) text: String,
}

#[derive(Clone)]
pub(super) enum Route {
    Turn(mpsc::UnboundedSender<Said>),
    Between(mpsc::UnboundedSender<Between>),
    /// A sub-agent's, `child`, to whoever hears its root's lanes.
    Lane(mpsc::UnboundedSender<LaneSaid>, String),
}

impl Routes {
    /// Where what `session` says goes: a sub-agent's to its lane, a
    /// Thread's own to its turn or to whoever hears it between turns.
    pub(super) fn of(&self, session: &acp::SessionId) -> Option<Route> {
        if self.child(session).is_some() {
            let lane = self.lane_of(session)?;
            return Some(Route::Lane(lane, session.0.to_string()));
        }
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

    /// A closed session: nothing goes to it any more, nor to the
    /// sub-agents it is the root of, whose lanes nobody hears now.
    pub(super) fn forget(&self, session: &acp::SessionId) {
        self.turns.lock().unwrap().remove(session);
        self.between.lock().unwrap().remove(session);
        self.lanes.lock().unwrap().remove(session);
        self.crews.lock().unwrap().remove(session);
        self.background.lock().unwrap().remove(session);
        (self.ties.lock().unwrap()).retain(|(root, _), _| root != session);
        let gone: Vec<acp::SessionId> = (self.children.lock().unwrap())
            .extract_if(|_, child| child.root == *session)
            .map(|(gone, _)| gone)
            .collect();
        let mut messages = self.messages.lock().unwrap();
        messages.retain(|(on, _), _| on != session && !gone.contains(on));
    }

    /// Whether a turn's prompt runs in `session` now.
    pub(super) fn prompting(&self, session: &acp::SessionId) -> bool {
        self.turns.lock().unwrap().contains_key(session)
    }

    /// Whether a turn's prompt runs in any session, or work of a Thread's
    /// goes on in the background that is not Claude's own housekeeping
    /// (ADR 0103, decision 11).
    pub(super) fn busy(&self) -> bool {
        if !self.turns.lock().unwrap().is_empty() {
            return true;
        }
        let background = self.background.lock().unwrap();
        background.values().flatten().any(|task| !task.ambient)
    }

    /// What goes on in the background of `session` now, as Claude lists it.
    pub(super) fn set_background(&self, session: &acp::SessionId, tasks: Vec<Background>) {
        let mut background = self.background.lock().unwrap();
        if tasks.is_empty() {
            background.remove(session);
        } else {
            background.insert(session.clone(), tasks);
        }
    }

    /// The task of the one Crew at work in the background of `session`, if
    /// exactly one is: what its agents ask between turns is its own (ADR
    /// 0103, decision 28).
    pub(super) fn crew_alone(&self, session: &acp::SessionId) -> Option<String> {
        let background = self.background.lock().unwrap();
        let mut crews = (background.get(session).into_iter().flatten())
            .filter(|task| task.kind == TaskKind::Workflow && !task.ambient);
        let alone = crews.next()?;
        crews.next().is_none().then(|| alone.task.clone())
    }

    /// Hears what the Crews of `root`, a Thread's session, say, from now
    /// on; `None` while someone already hears them.
    pub(super) fn hear_crews(
        &self,
        root: &acp::SessionId,
    ) -> Option<mpsc::UnboundedReceiver<CrewSaid>> {
        let mut crews = self.crews.lock().unwrap();
        if crews.get(root).is_some_and(|heard| !heard.is_closed()) {
            return None;
        }
        let (said, hear) = mpsc::unbounded_channel();
        crews.insert(root.clone(), said);
        Some(hear)
    }

    /// Whoever hears the Crews of `root`, while someone does.
    pub(super) fn crews_of(
        &self,
        root: &acp::SessionId,
    ) -> Option<mpsc::UnboundedSender<CrewSaid>> {
        let crews = self.crews.lock().unwrap();
        crews.get(root).filter(|heard| !heard.is_closed()).cloned()
    }

    /// Keeps what Claude's raw frames tie a sub-agent of `root` to.
    pub(super) fn keep_tie(&self, root: &acp::SessionId, tie: Tie) {
        let key = (root.clone(), tie.launch.clone());
        self.ties.lock().unwrap().insert(key, tie);
    }

    /// What ties the sub-agent launched by tool use `launch`, briefed on
    /// `on`, if Claude's raw frames said it already.
    pub(super) fn tie(&self, on: &acp::SessionId, launch: &str) -> Option<Tie> {
        let root = self.announce(on)?;
        let ties = self.ties.lock().unwrap();
        ties.get(&(root, launch.to_owned())).cloned()
    }

    /// The child the tool use `launch` briefed, among `root`'s, once its
    /// brief came.
    pub(super) fn briefed(&self, root: &acp::SessionId, launch: &str) -> Option<acp::SessionId> {
        let messages = self.messages.lock().unwrap();
        let mut briefs = messages.iter().filter(|((on, id), message)| {
            id == launch && message.sender.as_ref() == Some(on) && message.recipient.is_some()
        });
        let found = briefs.find_map(|(_, message)| message.recipient.clone())?;
        drop(messages);
        let child = self.child(&found)?;
        (child.root == *root).then_some(found)
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

    /// Hears what the sub-agents of `root`, a Thread's session, say, from
    /// now on; `None` while someone already hears them.
    pub(super) fn hear_lanes(
        &self,
        root: &acp::SessionId,
    ) -> Option<mpsc::UnboundedReceiver<LaneSaid>> {
        let mut lanes = self.lanes.lock().unwrap();
        if lanes.get(root).is_some_and(|heard| !heard.is_closed()) {
            return None;
        }
        let (said, hear) = mpsc::unbounded_channel();
        lanes.insert(root.clone(), said);
        Some(hear)
    }

    /// Whoever hears the lanes of `root`, while someone does.
    pub(super) fn lane(&self, root: &acp::SessionId) -> Option<mpsc::UnboundedSender<LaneSaid>> {
        let lanes = self.lanes.lock().unwrap();
        lanes.get(root).filter(|heard| !heard.is_closed()).cloned()
    }

    /// Whoever hears the lane of the known child `session`, while someone
    /// hears its root's lanes.
    pub(super) fn lane_of(
        &self,
        session: &acp::SessionId,
    ) -> Option<mpsc::UnboundedSender<LaneSaid>> {
        self.lane(&self.child(session)?.root)
    }

    /// The root of a child announced on `on`: `on` itself while its lanes
    /// are heard, or the root of the known child `on` is. `None` for a
    /// session nobody listens to, as a load's replay or a short run's.
    pub(super) fn announce(&self, on: &acp::SessionId) -> Option<acp::SessionId> {
        if self.lane(on).is_some() {
            return Some(on.clone());
        }
        self.child(on).map(|child| child.root)
    }

    /// The known child `session`, as it was announced.
    pub(super) fn child(&self, session: &acp::SessionId) -> Option<Child> {
        self.children.lock().unwrap().get(session).cloned()
    }

    /// Keeps `session` as a child.
    pub(super) fn adopt(&self, session: acp::SessionId, child: Child) {
        self.children.lock().unwrap().insert(session, child);
    }

    /// Whether message `id` to the known child `session` is its brief: the
    /// first its parent sent it, which each later piece of it names again.
    /// Any other is a message after it (ADR 0103, decision 25).
    pub(super) fn briefs(&self, session: &acp::SessionId, id: &str) -> bool {
        let mut children = self.children.lock().unwrap();
        let Some(child) = children.get_mut(session) else {
            return false;
        };
        child.brief.get_or_insert_with(|| id.to_owned()) == id
    }

    /// Whether the known child `session` may be stopped alone now, as the
    /// patch of its capabilities says: omitted keeps it, `null` clears it,
    /// an object says it. `None` for a child it does not know.
    pub(super) fn patch_cancel(
        &self,
        session: &acp::SessionId,
        capabilities: &MaybeUndefined<acp::SubagentSessionCapabilities>,
    ) -> Option<bool> {
        let mut children = self.children.lock().unwrap();
        let child = children.get_mut(session)?;
        child.cancel = cancel_of(child.cancel, capabilities);
        Some(child.cancel)
    }

    /// Changes the message `id` that came on `on` as `change` says, and
    /// answers what it is now; nothing for a session nobody listens to.
    pub(super) fn message<T>(
        &self,
        on: &acp::SessionId,
        id: &str,
        change: impl FnOnce(&mut Message) -> T,
    ) -> Option<T> {
        self.announce(on)?;
        let mut messages = self.messages.lock().unwrap();
        let message = messages.entry((on.clone(), id.to_owned())).or_default();
        Some(change(message))
    }

    /// Everyone who listens hears that the Harness is gone.
    pub(super) fn clear(&self) {
        self.turns.lock().unwrap().clear();
        self.between.lock().unwrap().clear();
        self.lanes.lock().unwrap().clear();
        self.children.lock().unwrap().clear();
        self.messages.lock().unwrap().clear();
        self.crews.lock().unwrap().clear();
        self.background.lock().unwrap().clear();
        self.ties.lock().unwrap().clear();
    }
}

impl Route {
    /// False when nobody listens any more.
    pub(super) fn send(&self, said: Said) -> bool {
        match self {
            Route::Turn(turn) => turn.send(said).is_ok(),
            Route::Between(between) => between.send(Between::Said(said)).is_ok(),
            Route::Lane(lane, child) => {
                let child = child.clone();
                lane.send(LaneSaid::Said { child, said }).is_ok()
            }
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

    fn child_of(root: &acp::SessionId) -> Child {
        Child {
            root: root.clone(),
            cancel: false,
            brief: None,
        }
    }

    #[test]
    fn a_childs_first_message_is_its_brief_and_every_other_comes_after() {
        let (routes, root) = (Routes::default(), acp::SessionId::new("root"));
        let child = acp::SessionId::new("child");
        assert!(!routes.briefs(&child, "first"), "a child it does not know");
        routes.adopt(child.clone(), child_of(&root));
        assert!(routes.briefs(&child, "first"));
        assert!(routes.briefs(&child, "first"), "more of it");
        assert!(!routes.briefs(&child, "then"));
        assert!(routes.briefs(&child, "first"), "it stays its brief");
    }

    #[test]
    fn a_child_announced_on_a_session_nobody_listens_to_is_not_mapped() {
        let (routes, session) = (Routes::default(), acp::SessionId::new("s"));
        // Heard between turns, as a load's replay is not, but not its lanes.
        let _between = routes.hear(&session).unwrap();
        assert_eq!(routes.announce(&session), None);
        assert!(routes.message(&session, "m", |_| ()).is_none());
        // Once its lanes are heard, it is the root, while they are.
        let lanes = routes.hear_lanes(&session).unwrap();
        assert_eq!(routes.announce(&session), Some(session.clone()));
        assert!(routes.hear_lanes(&session).is_none(), "heard once");
        drop(lanes);
        assert_eq!(routes.announce(&session), None);
        assert!(routes.hear_lanes(&session).is_some(), "heard again");
    }

    #[test]
    fn a_grandchild_maps_through_its_known_parent() {
        let routes = Routes::default();
        let (root, child) = (acp::SessionId::new("root"), acp::SessionId::new("child"));
        let mut lanes = routes.hear_lanes(&root).unwrap();
        assert_eq!(routes.announce(&root), Some(root.clone()));
        routes.adopt(child.clone(), child_of(&root));
        assert_eq!(routes.announce(&child), Some(root.clone()));
        let grandchild = acp::SessionId::new("grandchild");
        routes.adopt(grandchild.clone(), child_of(&root));
        // What a grandchild says goes to its root's lanes, as its own.
        let Some(route @ Route::Lane(..)) = routes.of(&grandchild) else {
            panic!("a grandchild's words go to its lane");
        };
        assert!(route.send(reply("deep")));
        assert!(matches!(
            lanes.try_recv(),
            Ok(LaneSaid::Said { child, said: Said::Reply { text, .. } })
                if child == "grandchild" && text == "deep"
        ));
        // The root closed: its children go with it.
        routes.forget(&root);
        assert_eq!(routes.child(&child), None);
        assert_eq!(routes.announce(&grandchild), None);
    }

    #[test]
    fn a_capabilities_patch_keeps_what_it_omits() {
        let (routes, root) = (Routes::default(), acp::SessionId::new("root"));
        let child = acp::SessionId::new("child");
        let can = acp::SubagentSessionCapabilities::new;
        assert_eq!(routes.patch_cancel(&child, &MaybeUndefined::Null), None);
        routes.adopt(child.clone(), child_of(&root));
        let stop = MaybeUndefined::Value(can().cancel(acp::SessionCancelCapabilities::new()));
        assert_eq!(routes.patch_cancel(&child, &stop), Some(true));
        assert_eq!(
            routes.patch_cancel(&child, &MaybeUndefined::Undefined),
            Some(true)
        );
        assert!(routes.child(&child).unwrap().cancel);
        assert_eq!(
            routes.patch_cancel(&child, &MaybeUndefined::Null),
            Some(false)
        );
        assert_eq!(routes.patch_cancel(&child, &stop), Some(true));
        assert_eq!(
            routes.patch_cancel(&child, &MaybeUndefined::Value(can())),
            Some(false)
        );
        assert!(!routes.child(&child).unwrap().cancel);
    }
}
