//! A Thread's sub-agents, each a lane of it (ADR 0103, decisions 7 and 8).
//!
//! A Harness that declares sub-agents says what each does on a session of
//! its own, its child session. The Thread's session hears them apart from
//! its turns ([`Session::lanes`]), so nothing a sub-agent says opens a
//! turn, and each is heard by a task of its own, in the order it was said.
//!
//! A sub-agent starts where its parent said it, after what came before:
//! the turn that heard it writes its start, or its parent's lane for a
//! nested one (`transcript.rs`); when nobody did, its lane writes it,
//! last. Its words go into its lane, by a Transcript of the lane. Its
//! record is kept as it changes, in the same write as the fact of the
//! change: `subagent.started`, `subagent.changed` and `subagent.ended`.
//!
//! A lane at work, running or asking, keeps its Harness's process and the
//! machine from going idle, and touches files. Its Questions close when
//! it ends. One that Banda cut off as it let the process go ends Lost, in
//! words that say why (decision 3), as does every lane at work when Banda
//! restarts.

use crate::acp::{Announced, IdleWhy, LaneSaid, LaneState, Session, StartedRx, WeakSession};
use crate::between::ENDING;
use crate::live::{Cut, LaneRun, Live};
use crate::model::{
    Body, Fact, Item, ItemId, Subagent, SubagentId, SubagentState, ThreadId, TurnId,
};
use crate::touching::Toucher;
use crate::transcript::{self, Holder, Transcript};
use crate::{emit, plain, questions, store};
use banda_kernel::{AgentId, Error, ModuleProject, Participant, Tx};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tokio::sync::mpsc;

/// Why a lane at work when Banda stopped is Lost.
const RESTARTED: &str = "Stopped when Banda restarted.";
/// Why a lane the Person stopped is Stopped.
const BY_YOU: &str = "Stopped by you";

/// Who hears a Thread's sub-agents.
pub struct Hearer {
    pub live: Arc<Live>,
    pub project: ModuleProject,
    pub thread: ThreadId,
    pub agent: AgentId,
    /// Its Harness's name, for plain words.
    pub harness: String,
}

/// Which lane a sub-agent was kept as, and its launch turn, once it was:
/// the lanes it starts write their own start under it when nobody did.
type Kept = Arc<OnceLock<(SubagentId, TurnId)>>;

impl Hearer {
    /// Hears the sub-agents of `session` from now on, unless someone
    /// already does. It stops when the session closes or the Harness is
    /// gone, and never keeps a session that is let go.
    pub fn hear(self, session: &Session) {
        let Some(hear) = session.lanes() else {
            return;
        };
        tokio::spawn(Arc::new(self).listen(session.downgrade(), hear));
    }

    /// Hands what each sub-agent says to its lane's task, a new one for a
    /// sub-agent seen for the first time.
    async fn listen(
        self: Arc<Self>,
        session: WeakSession,
        mut hear: mpsc::UnboundedReceiver<LaneSaid>,
    ) {
        let mut lanes: HashMap<String, (mpsc::UnboundedSender<LaneSaid>, Kept)> = HashMap::new();
        while let Some(said) = hear.recv().await {
            if let Some(session) = session.upgrade() {
                session.touch();
            }
            let child = said.child().to_owned();
            if let LaneSaid::Seen { parent, .. } = &said
                && !lanes.contains_key(&child)
            {
                let under = parent.as_ref().and_then(|parent| lanes.get(parent));
                let under = under.map(|(_, kept)| kept.clone());
                let (to_lane, heard) = mpsc::unbounded_channel();
                let kept = Kept::default();
                let lane = Lane::run(self.clone(), session.clone(), kept.clone(), under, heard);
                tokio::spawn(lane);
                lanes.insert(child.clone(), (to_lane, kept));
            }
            match lanes.get(&child) {
                Some((lane, _)) => {
                    let _ = lane.send(said);
                }
                None => tracing::debug!("a sub-agent Banda did not see start said something"),
            }
        }
    }

    /// Writes the start of sub-agent `announced` that nobody wrote: under
    /// lane `under`, in its launch turn, for a nested one; else last in
    /// the Thread, in its latest turn. None when the Thread has no turn.
    async fn started(
        &self,
        announced: &Announced,
        under: Option<(SubagentId, TurnId)>,
    ) -> Result<Option<Subagent>, String> {
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        let announced = announced.clone();
        self.project
            .write(move |tx| {
                let (parent, turn) = match under {
                    Some((parent, turn)) => (Some(parent), turn),
                    None => match store::last_begun(tx.sql(), thread)? {
                        Some(latest) => (None, latest.turn),
                        None => return Ok(None),
                    },
                };
                start(tx, agent, thread, &announced, turn, parent).map(Some)
            })
            .await
            .map_err(plain)
    }
}

/// Keeps sub-agent `announced`, started in `turn` of `thread`, under lane
/// `parent` for a nested one: its lane, at work, and the entry that shows
/// it, last of its parent's. One the Thread keeps for that child session
/// already, as a child announced again or replayed, writes nothing (ADR
/// 0103, decision 7). The lane as kept.
pub fn start(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    announced: &Announced,
    turn: TurnId,
    parent: Option<SubagentId>,
) -> Result<Subagent, Error> {
    let lane = Subagent {
        id: SubagentId::new(),
        turn,
        parent,
        title: announced.title.clone().unwrap_or_default(),
        role: announced.role.clone(),
        model: None,
        state: SubagentState::Running,
        why: None,
        can_stop: announced.cancel,
        started: tx.now(),
        ended: None,
        prompt: None,
        report: None,
    };
    let item = ItemId::new();
    let kept = store::insert_lane(tx.sql(), thread, &lane, item, &announced.child)?;
    if let store::Upserted::Known(known) = kept {
        return Ok(*known);
    }
    let anchor = Item {
        id: item,
        turn: Some(turn),
        author: agent,
        at: tx.now(),
        body: Body::Subagent { subagent: lane.id },
    };
    store::insert_item(tx.sql(), thread, &anchor, parent)?;
    let started = Fact::SubagentStarted {
        item,
        subagent: lane.clone(),
    };
    emit(tx, agent, thread, &started)?;
    Ok(lane)
}

/// Banda restarted: every lane that was at work is Lost, and its
/// Questions close. Called as the Project opens, before anything runs.
pub fn lost(tx: &mut Tx<'_>) -> Result<(), Error> {
    for (thread, was) in store::every_lane_at_work(tx.sql())? {
        let Some(agent) = store::agent_of(tx.sql(), thread)? else {
            continue;
        };
        let now = Subagent {
            state: SubagentState::Lost,
            why: Some(RESTARTED.to_owned()),
            can_stop: false,
            ..was.clone()
        };
        keep(tx, Participant::Agent(agent), thread, &was, now, None)?;
    }
    Ok(())
}

/// Keeps `now`, what lane `was` is now, and tells its Thread what changed
/// or that it ended, all in one write; nothing when nothing changed. An
/// end closes its Questions, and its report is `replied`, else its last
/// reply, else the one it had. The record as kept.
fn keep(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    was: &Subagent,
    mut now: Subagent,
    replied: Option<String>,
) -> Result<Subagent, Error> {
    let ended = ends(was, &now);
    if ended {
        now.ended = Some(tx.now());
        let last = store::last_lane_reply(tx.sql(), now.id)?;
        now.report = replied.or(last).or(now.report);
    }
    let facts = facts(was, &now);
    if facts.is_empty() {
        return Ok(now);
    }
    store::set_lane(tx.sql(), &now)?;
    for fact in &facts {
        emit(tx, agent, thread, fact)?;
    }
    if ended {
        questions::close_lane(tx, agent, thread, now.id)?;
    }
    Ok(now)
}

/// Whether lane `was` ends as `now`: it stops working, or, ended, ends
/// another way.
pub fn ends(was: &Subagent, now: &Subagent) -> bool {
    !now.state.works() && (was.state.works() || was.state != now.state || was.why != now.why)
}

/// The facts of lane `was` becoming `now`: what changed of it, and then
/// its end, if it ends.
pub fn facts(was: &Subagent, now: &Subagent) -> Vec<Fact> {
    let mut facts: Vec<Fact> = patch(was, now).into_iter().collect();
    if ends(was, now) {
        facts.push(Fact::SubagentEnded {
            subagent: now.id,
            turn: now.turn,
            state: now.state,
            why: now.why.clone(),
            report: now.report.clone(),
            ended: now.ended.unwrap_or(now.started),
        });
    }
    facts
}

/// What changed of lane `was`, now `now`, as `subagent.changed`; none when
/// nothing did. Its state goes in only at work, its why never: an end
/// says those, its report and that it can no longer be stopped.
pub fn patch(was: &Subagent, now: &Subagent) -> Option<Fact> {
    // A field the Harness cannot clear is said only as it is set.
    fn set(was: &Option<String>, now: &Option<String>) -> Option<String> {
        if was == now { None } else { now.clone() }
    }
    let ending = ends(was, now);
    let state = (now.state.works() && was.state != now.state).then_some(now.state);
    let title = (was.title != now.title).then(|| now.title.clone());
    let role = (was.role != now.role).then(|| now.role.clone());
    let (model, prompt) = (set(&was.model, &now.model), set(&was.prompt, &now.prompt));
    let (can_stop, report) = if ending {
        (None, None)
    } else {
        let can_stop = (was.can_stop != now.can_stop).then_some(now.can_stop);
        (can_stop, set(&was.report, &now.report))
    };
    let nothing = state.is_none()
        && title.is_none()
        && role.is_none()
        && model.is_none()
        && prompt.is_none()
        && can_stop.is_none()
        && report.is_none();
    (!nothing).then_some(Fact::SubagentChanged {
        subagent: now.id,
        state,
        title,
        role,
        model,
        can_stop,
        why: None,
        prompt,
        report,
    })
}

/// What a state the Harness says makes of a lane.
#[derive(Debug, PartialEq, Eq)]
enum Next {
    /// It leaves it as it was.
    Keep,
    /// It is in `0` now, for why `1`.
    Is(SubagentState, Option<String>),
    /// It stopped: by the Person, when the Person asked it to.
    Stopped,
}

/// What `said` makes of a lane of `harness`, at work or not as `works`
/// says, which Banda cut off as `cut` says, if it did (ADR 0103, decision
/// 3). A cancel heard once it ended changes nothing: one its Harness sent
/// it after, or for its parent.
fn next(said: LaneState, works: bool, cut: Option<Cut>, harness: &str) -> Next {
    let failed = |why: &str| Next::Is(SubagentState::Failed, Some(why.to_owned()));
    match said {
        LaneState::Running => Next::Is(SubagentState::Running, None),
        LaneState::Asks => Next::Is(SubagentState::Asks, None),
        LaneState::Idle(IdleWhy::EndTurn | IdleWhy::Unsaid) => Next::Is(SubagentState::Done, None),
        LaneState::Idle(IdleWhy::Cancelled) if !works => Next::Keep,
        // What Banda cut off stops as cancelled: why it did wins.
        LaneState::Idle(IdleWhy::Cancelled) => match cut {
            Some(cut) => Next::Is(SubagentState::Lost, Some(cut_words(&cut, harness))),
            None => Next::Stopped,
        },
        LaneState::Idle(IdleWhy::Error(said)) if said.is_empty() => {
            failed(&format!("{harness} said the sub-agent failed."))
        }
        LaneState::Idle(IdleWhy::Error(said)) => failed(&said),
        LaneState::Idle(IdleWhy::Refusal) => failed("It refused to go on."),
        LaneState::Idle(IdleWhy::MaxTokens) => failed("It ran out of room to answer."),
        LaneState::Idle(IdleWhy::MaxTurnRequests) => failed("It reached its limit of steps."),
        LaneState::Unknown => Next::Is(
            SubagentState::Lost,
            Some(format!("{harness} cannot say how it goes.")),
        ),
        LaneState::Other => Next::Keep,
    }
}

/// Why a lane Banda cut off is Lost.
fn cut_words(cut: &Cut, harness: &str) -> String {
    match cut {
        Cut::Trust => "Stopped when you changed the Project's trust.".to_owned(),
        Cut::Account => format!("Stopped when {harness}'s account changed."),
        Cut::Moved(to) => format!("Stopped when the Thread moved to {to}."),
    }
}

/// One sub-agent's lane, as its task hears it.
struct Lane {
    hearer: Arc<Hearer>,
    session: WeakSession,
    /// Its child session, as the Harness names it.
    child: String,
    /// It as kept.
    record: Subagent,
    /// The Harness lets it be stopped alone.
    cancel: bool,
    /// What writes its words.
    transcript: Transcript,
    /// Held while it is at work.
    run: Option<LaneRun>,
    /// Its last report to its parent, once it gave one since it last
    /// went to work.
    replied: Option<String>,
    /// The message of its parent's that is its prompt: the first.
    briefed: Option<String>,
}

impl Lane {
    /// Hears sub-agent `child`: where its start was kept, then what it
    /// says, until the Harness says no more.
    async fn run(
        hearer: Arc<Hearer>,
        session: WeakSession,
        kept: Kept,
        under: Option<Kept>,
        mut hear: mpsc::UnboundedReceiver<LaneSaid>,
    ) {
        let Some(LaneSaid::Seen {
            announced,
            started,
            held,
            ..
        }) = hear.recv().await
        else {
            return;
        };
        let lane = Lane::start(hearer, session, &announced, under, started).await;
        // Its process was held from its announcement; its lane holds it now.
        drop(held);
        let Some(mut lane) = lane else {
            return;
        };
        let _ = kept.set((lane.record.id, lane.record.turn));
        lane.announced(announced).await;
        lane.listen(&mut hear).await;
    }

    /// Where sub-agent `announced` was kept, as `started` says, or as its
    /// lane writes it when nobody did in time.
    async fn start(
        hearer: Arc<Hearer>,
        session: WeakSession,
        announced: &Announced,
        under: Option<Kept>,
        started: StartedRx,
    ) -> Option<Lane> {
        let kept = match tokio::time::timeout(ENDING, started).await {
            Ok(Ok(kept)) => Ok(Some(kept)),
            _ => {
                let under = under.and_then(|under| under.get().copied());
                hearer.started(announced, under).await
            }
        };
        let record = match kept {
            Ok(Some(record)) => record,
            Ok(None) => {
                tracing::warn!("a sub-agent started in a Thread with no turn");
                return None;
            }
            Err(error) => {
                tracing::warn!(%error, "a sub-agent's start could not be written");
                return None;
            }
        };
        let native = session
            .upgrade()
            .is_some_and(|session| session.running().native);
        let transcript = Transcript::lane(
            hearer.project.clone(),
            hearer.thread,
            hearer.agent,
            record.turn,
            record.id,
            hearer.harness.clone(),
            native,
            hearer.live.doings().clone(),
        );
        let mut lane = Lane {
            cancel: record.can_stop,
            child: announced.child.clone(),
            hearer,
            session,
            record,
            transcript,
            run: None,
            replied: None,
            briefed: None,
        };
        lane.hold();
        Some(lane)
    }

    async fn listen(mut self, hear: &mut mpsc::UnboundedReceiver<LaneSaid>) {
        loop {
            let gathered = transcript::until(self.transcript.due());
            tokio::select! {
                biased;
                said = hear.recv() => match said {
                    Some(said) => self.heard(said).await,
                    None => break,
                },
                () = gathered => {
                    if let Err(error) = self.transcript.write_gathered().await {
                        tracing::warn!(%error, "what a sub-agent said could not be written");
                    }
                }
            }
        }
        self.gone().await;
    }

    async fn heard(&mut self, said: LaneSaid) {
        match said {
            LaneSaid::Said { said, .. } => {
                let holder = Holder::Lane(self.run.as_ref());
                if let Err(error) = self.transcript.hear(holder, said).await {
                    tracing::warn!(%error, "what a sub-agent said could not be written");
                }
            }
            LaneSaid::Changed {
                title,
                role,
                cancel,
                state,
                ..
            } => {
                let mut now = self.record.clone();
                if let Some(title) = title {
                    now.title = title.unwrap_or_default();
                }
                if let Some(role) = role {
                    now.role = role;
                }
                if let Some(cancel) = cancel {
                    self.cancel = cancel;
                }
                self.change(now, state).await;
            }
            LaneSaid::Runs { model, role, .. } => {
                let mut now = self.record.clone();
                now.model = model.or(now.model);
                now.role = role.or(now.role);
                self.change(now, None).await;
            }
            LaneSaid::Brief { message, text, .. } => {
                if self.briefed.is_none() && self.record.prompt.is_none() {
                    self.briefed = Some(message.clone());
                }
                if self.briefed.as_ref() == Some(&message) {
                    let mut now = self.record.clone();
                    now.prompt = Some(text);
                    self.change(now, None).await;
                }
            }
            // At work, its report waits for its end; after, it is its
            // report at once.
            LaneSaid::Report { text, .. } => {
                self.replied = Some(text.clone());
                if !self.record.state.works() {
                    let mut now = self.record.clone();
                    now.report = Some(text);
                    self.change(now, None).await;
                }
            }
            // Announced again: it goes on in its lane.
            LaneSaid::Seen { announced, .. } => self.announced(announced).await,
        }
    }

    /// What its parent says it is as it announces it: what it gives
    /// replaces its own.
    async fn announced(&mut self, announced: Announced) {
        let mut now = self.record.clone();
        if let Some(title) = announced.title {
            now.title = title;
        }
        if let Some(role) = announced.role {
            now.role = Some(role);
        }
        self.cancel = announced.cancel;
        self.change(now, announced.state).await;
    }

    /// Keeps `now`, in the state `said` makes of it, if the Harness said one.
    async fn change(&mut self, mut now: Subagent, said: Option<LaneState>) {
        let mut stopped = false;
        if let Some(said) = said {
            let cut = self.hearer.live.cut(self.record.id);
            let works = self.record.state.works();
            match next(said, works, cut, &self.hearer.harness) {
                Next::Keep => {}
                Next::Is(state, why) => (now.state, now.why) = (state, why),
                Next::Stopped => {
                    (now.state, now.why, stopped) = (SubagentState::Stopped, None, true)
                }
            }
        }
        if now.state.works() {
            (now.why, now.ended) = (None, None);
        }
        now.can_stop = self.cancel && now.state.works();
        self.write(now, stopped).await;
    }

    /// Writes `now`, as it is or as it ends; `stopped` says why it is
    /// Stopped once the store says who asked.
    async fn write(&mut self, now: Subagent, stopped: bool) {
        let was = self.record.clone();
        if ends(&was, &now) {
            // What it said before it ended is written before its end.
            if let Err(error) = self.transcript.close().await {
                tracing::warn!(%error, "what a sub-agent said could not be written");
            }
        }
        let (thread, agent) = (self.hearer.thread, Participant::Agent(self.hearer.agent));
        let replied = self.replied.clone();
        let kept = self
            .hearer
            .project
            .write(move |tx| {
                let mut now = now;
                if stopped && store::stopped_by_person(tx.sql(), now.id)? {
                    now.why = Some(BY_YOU.to_owned());
                }
                keep(tx, agent, thread, &was, now, replied)
            })
            .await
            .map_err(plain);
        match kept {
            Ok(now) => self.record = now,
            Err(error) => {
                tracing::warn!(%error, "a sub-agent's state could not be written");
                return;
            }
        }
        self.hold();
    }

    /// Holds it while it is at work, and lets go of it once it is not.
    fn hold(&mut self) {
        if !self.record.state.works() {
            self.run = None;
            self.transcript.set_toucher(None);
            return;
        }
        if self.run.is_some() {
            return;
        }
        let Some(session) = self.session.upgrade() else {
            return;
        };
        let (hearer, sub) = (&self.hearer, self.record.id);
        let (project, thread) = (hearer.project.id(), hearer.thread);
        self.run = Some(
            hearer
                .live
                .lane(project, thread, sub, &self.child, &session),
        );
        let touches = hearer.live.touches().clone();
        let toucher = Toucher::lane(touches, project, thread, sub);
        self.transcript.set_toucher(Some(toucher));
        self.replied = None;
    }

    /// The Harness says no more of it: still at work, it is Lost, for
    /// why Banda cut it off, else as its Harness stopped.
    async fn gone(mut self) {
        if let Err(error) = self.transcript.close().await {
            tracing::warn!(%error, "what a sub-agent said could not be written");
        }
        if !self.record.state.works() {
            return;
        }
        let harness = &self.hearer.harness;
        let why = match self.hearer.live.cut(self.record.id) {
            Some(cut) => cut_words(&cut, harness),
            None => format!("{harness} stopped while it worked."),
        };
        let now = Subagent {
            state: SubagentState::Lost,
            why: Some(why),
            can_stop: false,
            ..self.record.clone()
        };
        self.write(now, false).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lane() -> Subagent {
        Subagent {
            id: SubagentId::new(),
            turn: TurnId::new(),
            parent: None,
            title: "Find the bug".to_owned(),
            role: Some("Explore".to_owned()),
            model: None,
            state: SubagentState::Running,
            why: None,
            can_stop: true,
            started: 1,
            ended: None,
            prompt: None,
            report: None,
        }
    }

    #[test]
    fn a_lane_as_it_was_writes_nothing() {
        let was = lane();
        assert!(facts(&was, &was.clone()).is_empty());
        let ended = Subagent {
            state: SubagentState::Done,
            ended: Some(2),
            report: Some("banana".to_owned()),
            ..was
        };
        assert!(facts(&ended, &ended.clone()).is_empty(), "idle again");
    }

    #[test]
    fn a_change_says_only_what_changed_and_never_why() {
        let was = lane();
        let now = Subagent {
            title: "Find two bugs".to_owned(),
            role: None,
            model: Some("Haiku 5.5".to_owned()),
            state: SubagentState::Asks,
            why: Some("not said".to_owned()),
            ..was.clone()
        };
        let Some(Fact::SubagentChanged {
            state,
            title,
            role,
            model,
            can_stop,
            why,
            prompt,
            report,
            ..
        }) = patch(&was, &now)
        else {
            panic!("a change");
        };
        assert_eq!(state, Some(SubagentState::Asks));
        assert_eq!(title.as_deref(), Some("Find two bugs"));
        assert_eq!(role, Some(None), "cleared");
        assert_eq!(model.as_deref(), Some("Haiku 5.5"));
        assert_eq!((can_stop, why, prompt, report), (None, None, None, None));
    }

    #[test]
    fn an_end_says_its_state_why_and_report_once_after_what_else_changed() {
        let was = lane();
        let now = Subagent {
            title: "Found it".to_owned(),
            state: SubagentState::Failed,
            why: Some("It refused to go on.".to_owned()),
            can_stop: false,
            ended: Some(5),
            report: Some("cherry".to_owned()),
            ..was.clone()
        };
        let facts = facts(&was, &now);
        let [
            Fact::SubagentChanged {
                title,
                state: None,
                can_stop: None,
                report: None,
                ..
            },
            Fact::SubagentEnded {
                state,
                why,
                report,
                ended,
                turn,
                ..
            },
        ] = facts.as_slice()
        else {
            panic!("a change, then an end: {facts:?}");
        };
        assert_eq!(title.as_deref(), Some("Found it"));
        assert_eq!(*state, SubagentState::Failed);
        assert_eq!(why.as_deref(), Some("It refused to go on."));
        assert_eq!(report.as_deref(), Some("cherry"));
        assert_eq!((*ended, *turn), (5, was.turn));
        assert!(!ends(&now, &now.clone()), "it ends once");
    }

    #[test]
    fn a_lane_that_works_again_after_its_end_is_changed_back_not_started() {
        let was = Subagent {
            state: SubagentState::Lost,
            why: Some("Fake cannot say how it goes.".to_owned()),
            can_stop: false,
            ended: Some(3),
            ..lane()
        };
        let now = Subagent {
            state: SubagentState::Running,
            why: None,
            ended: None,
            can_stop: true,
            ..was.clone()
        };
        let facts = facts(&was, &now);
        let [
            Fact::SubagentChanged {
                state: Some(SubagentState::Running),
                can_stop: Some(true),
                ..
            },
        ] = facts.as_slice()
        else {
            panic!("one change: {facts:?}");
        };
    }

    #[test]
    fn what_the_harness_says_of_a_lane_is_its_state_in_banda_words() {
        let is = |state, why: &str| Next::Is(state, Some(why.to_owned()));
        let idle = |why| LaneState::Idle(why);
        let cases = [
            (
                LaneState::Running,
                None,
                Next::Is(SubagentState::Running, None),
            ),
            (LaneState::Asks, None, Next::Is(SubagentState::Asks, None)),
            (
                idle(IdleWhy::EndTurn),
                None,
                Next::Is(SubagentState::Done, None),
            ),
            (
                idle(IdleWhy::Unsaid),
                None,
                Next::Is(SubagentState::Done, None),
            ),
            (idle(IdleWhy::Cancelled), None, Next::Stopped),
            (
                idle(IdleWhy::Cancelled),
                Some(Cut::Moved("Codex".to_owned())),
                is(
                    SubagentState::Lost,
                    "Stopped when the Thread moved to Codex.",
                ),
            ),
            (
                idle(IdleWhy::Cancelled),
                Some(Cut::Account),
                is(SubagentState::Lost, "Stopped when Fake's account changed."),
            ),
            (
                idle(IdleWhy::Cancelled),
                Some(Cut::Trust),
                is(
                    SubagentState::Lost,
                    "Stopped when you changed the Project's trust.",
                ),
            ),
            (
                idle(IdleWhy::Error(String::new())),
                None,
                is(SubagentState::Failed, "Fake said the sub-agent failed."),
            ),
            (
                idle(IdleWhy::Error("no network".to_owned())),
                None,
                is(SubagentState::Failed, "no network"),
            ),
            (
                idle(IdleWhy::Refusal),
                None,
                is(SubagentState::Failed, "It refused to go on."),
            ),
            (
                idle(IdleWhy::MaxTokens),
                None,
                is(SubagentState::Failed, "It ran out of room to answer."),
            ),
            (
                idle(IdleWhy::MaxTurnRequests),
                None,
                is(SubagentState::Failed, "It reached its limit of steps."),
            ),
            (
                LaneState::Unknown,
                None,
                is(SubagentState::Lost, "Fake cannot say how it goes."),
            ),
            (LaneState::Other, None, Next::Keep),
        ];
        for (said, cut, expected) in cases {
            assert_eq!(next(said.clone(), true, cut, "Fake"), expected, "{said:?}");
        }
        // Ended, it is not stopped again; it may work again.
        let cancelled = idle(IdleWhy::Cancelled);
        assert_eq!(next(cancelled, false, None, "Fake"), Next::Keep);
        let back = next(LaneState::Running, false, None, "Fake");
        assert_eq!(back, Next::Is(SubagentState::Running, None));
    }
}
