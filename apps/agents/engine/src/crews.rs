//! A Thread's Crews (ADR 0103, decisions 2, 9, 18 and 19): what Claude
//! Code calls a workflow, the sub-agents one Thread sets to work together
//! in phases. Built as `lanes.rs` is.
//!
//! A Crew is heard from Claude's raw frames on the Thread's session
//! ([`Hearer`]), apart from its turns: its task starts it, where Claude
//! started it, in the turn that runs; each `workflow_progress` says its
//! whole tree, and a change of an agent's state, a phase, a count or the
//! log line is written, never a frame that changes none of them; its task's
//! end ends it, with what it gave back, read once from its output file.
//!
//! A Crew at work keeps its Thread working: its process held and the
//! machine awake ([`Live::crew`]), and its Thread counted as at work by the
//! list, the Mark, the bar, archive and an update. Its agents' calls and
//! Questions between turns are its own while it is the one Crew at work
//! (`between.rs`), and end and close with it. One Banda cut off as it let
//! the process go ends Lost in words that say why (decision 3), as does
//! every Crew at work when Banda restarts.

use crate::acp::{self, CrewSaid, Notified, Progress, Sdk, Started, TaskEnd, TaskKind};
use crate::live::{CrewRun, Cut, Live};
use crate::model::{
    Body, Crew, CrewAgent, CrewBrief, CrewId, CrewState, Fact, Item, ItemId, ThreadId, ToolStatus,
    TurnId,
};
use crate::transcript::{Holder, Transcript};
use crate::{emit, plain, questions, store};
use banda_kernel::{AgentId, Error, ModuleProject, Participant, Tx};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;

/// Why a Crew at work when Banda stopped is Lost.
const RESTARTED: &str = "Stopped when Banda restarted.";

/// The most of a Crew's output file Banda keeps as its Result.
pub const RESULT: u64 = 64 * 1024;

/// What names a Crew whose agent asks (ADR 0103, decisions 10 and 28).
pub fn asker(title: &str) -> String {
    format!("Crew {title}")
}

/// What a list says of Crew `crew` at work (ADR 0103, decision 10): the
/// phase of its agent that started last, and how many of that phase's
/// agents are done of those called so far.
pub fn brief(crew: &Crew) -> CrewBrief {
    let latest = (crew.agents.iter())
        .filter(|agent| agent.started.is_some())
        .max_by_key(|agent| (agent.started, agent.phase, agent.index))
        .or_else(|| crew.agents.last());
    let phase = latest.map(|agent| agent.phase).or_else(|| {
        let first = crew.phases.first();
        first.map(|phase| phase.index)
    });
    let Some(phase) = phase else {
        return CrewBrief {
            title: crew.title.clone(),
            phase: String::new(),
            done: 0,
            of: 0,
        };
    };
    let named = crew.phases.iter().find(|one| one.index == phase);
    let of: Vec<&CrewAgent> = (crew.agents.iter())
        .filter(|agent| agent.phase == phase)
        .collect();
    let done = of
        .iter()
        .filter(|agent| agent.state == crate::model::SubagentState::Done)
        .count();
    CrewBrief {
        title: crew.title.clone(),
        phase: named.map_or_else(|| format!("Phase {phase}"), |named| named.title.clone()),
        done: u16::try_from(done).unwrap_or(u16::MAX),
        of: u16::try_from(of.len()).unwrap_or(u16::MAX),
    }
}

/// What Claude's start of a workflow says of its Crew, started in `turn`
/// at `now`: its script's `meta`, else Claude's own words.
pub fn started(started: &Started, turn: TurnId, now: i64) -> Crew {
    let meta = started.prompt.as_deref().and_then(acp::crew_meta);
    let title = (started.name.clone())
        .or_else(|| meta.as_ref().map(|meta| meta.title.clone()))
        .or_else(|| started.description.clone())
        .unwrap_or_else(|| "Crew".to_owned());
    let description = (meta.as_ref())
        .and_then(|meta| meta.description.clone())
        .or_else(|| started.description.clone());
    Crew {
        id: CrewId::new(),
        turn,
        title,
        description,
        phases: meta.map(|meta| meta.phases).unwrap_or_default(),
        agents: Vec::new(),
        state: CrewState::Working,
        why: None,
        started: now,
        ended: None,
        tokens: None,
        log: None,
        script: started.prompt.clone(),
        result: None,
        went_on: None,
    }
}

/// What `progress` makes of Crew `was`: its whole tree as Claude says it
/// now, the phases' details from its script kept, and its tokens; a frame
/// with no tree changes only the tokens.
pub fn progressed(was: &Crew, progress: &Progress) -> Crew {
    let mut now = was.clone();
    if let Some(tokens) = progress.tokens {
        now.tokens = Some(tokens);
    }
    let Some(tree) = &progress.tree else {
        return now;
    };
    if !tree.phases.is_empty() {
        now.phases = (tree.phases.iter())
            .map(|phase| {
                let known = was.phases.iter().find(|one| one.index == phase.index);
                let detail = phase.detail.clone();
                crate::model::Phase {
                    detail: detail.or_else(|| known.and_then(|known| known.detail.clone())),
                    ..phase.clone()
                }
            })
            .collect();
    }
    // An agent keeps the lane it was tied to.
    now.agents = (tree.agents.iter())
        .map(|agent| {
            let known = was.agents.iter().find(|one| same(one, agent));
            CrewAgent {
                lane: agent.lane.or_else(|| known.and_then(|known| known.lane)),
                ..agent.clone()
            }
        })
        .collect();
    if tree.log.is_some() {
        now.log = tree.log.clone();
    }
    now
}

/// Whether two are the same agent: the same place in the same phase.
fn same(one: &CrewAgent, other: &CrewAgent) -> bool {
    (one.phase, one.index) == (other.phase, other.index)
}

/// What a Person would see change of an agent: not its tokens, its time or
/// what it does now, which change with each frame.
fn moved(was: &CrewAgent, now: &CrewAgent) -> bool {
    (
        &was.label,
        was.state,
        &was.model,
        was.attempt,
        &was.result,
        &was.why,
    ) != (
        &now.label,
        now.state,
        &now.model,
        now.attempt,
        &now.result,
        &now.why,
    )
}

/// The fact of Crew `was` becoming `now`, at work: only when an agent's
/// state, a phase, a count or the log line changed (ADR 0103, decision 8);
/// none for a frame that moved only tokens or times. It carries the agents
/// new or changed, each whole, the phases when they changed, and the
/// tokens as they are now.
pub fn progress(was: &Crew, now: &Crew) -> Option<Fact> {
    let known = |agent: &CrewAgent| was.agents.iter().find(|one| same(one, agent));
    let stirred =
        (now.agents.iter()).any(|agent| known(agent).is_none_or(|known| moved(known, agent)));
    // Kept with it is the whole of `now`: every agent that changed at all
    // rides along, its tokens and what it does now too, so the fact gives
    // what is kept.
    let agents: Vec<CrewAgent> = (now.agents.iter())
        .filter(|agent| known(agent) != Some(*agent))
        .cloned()
        .collect();
    let phases = (now.phases != was.phases).then(|| now.phases.clone());
    let log = (now.log != was.log).then(|| now.log.clone()).flatten();
    if !stirred && phases.is_none() && log.is_none() {
        return None;
    }
    Some(Fact::CrewProgressed {
        crew: now.id,
        phases,
        agents,
        log,
        tokens: now.tokens,
        went_on: None,
    })
}

/// Keeps Crew `crew`, which Claude's task `task` of run `run` started in
/// `thread`, and the entry that shows it, last in its turn. One the Thread
/// keeps for that task already, as a frame said again, writes nothing. The
/// Crew as kept.
pub fn start(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    crew: Crew,
    (task, run): (&str, Option<&str>),
) -> Result<Crew, Error> {
    let item = ItemId::new();
    if let store::Upserted::Known(known) =
        store::insert_crew(tx.sql(), thread, &crew, item, (task, run))?
    {
        return Ok(*known);
    }
    let anchor = Item {
        id: item,
        turn: Some(crew.turn),
        author: agent,
        at: tx.now(),
        body: Body::Crew { crew: crew.id },
    };
    store::insert_item(tx.sql(), thread, &anchor, None)?;
    emit(
        tx,
        agent,
        thread,
        &Fact::CrewStarted {
            item,
            crew: crew.clone(),
        },
    )?;
    Ok(crew)
}

/// Keeps Crew `now` at work, and its fact, when it moved.
fn keep_progress(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    was: &Crew,
    now: &Crew,
) -> Result<bool, Error> {
    let Some(fact) = progress(was, now) else {
        return Ok(false);
    };
    if store::agent_of(tx.sql(), thread)?.is_none() {
        return Ok(false);
    }
    store::set_crew(tx.sql(), now)?;
    emit(tx, agent, thread, &fact)?;
    Ok(true)
}

/// Ends Crew `now`, as its `state` and `why` say, and its agents'
/// Questions with it; its open calls end too, those it still keeps in the
/// store, as after a restart. Nothing when it ended already.
fn end(
    tx: &mut Tx<'_>,
    agent: Participant,
    thread: ThreadId,
    mut now: Crew,
) -> Result<Crew, Error> {
    let Some((_, was)) = store::crew(tx.sql(), now.id)? else {
        return Ok(now);
    };
    if !was.state.works() || store::agent_of(tx.sql(), thread)?.is_none() {
        return Ok(was);
    }
    now.ended = Some(tx.now());
    store::set_crew(tx.sql(), &now)?;
    // Its calls end as it did: done with a Crew that is done.
    let ended = match now.state {
        CrewState::Done => ToolStatus::Done,
        _ => ToolStatus::Failed,
    };
    for mut item in store::crew_open_calls(tx.sql(), now.id)? {
        if let Body::Tool { status, .. } = &mut item.body {
            *status = ended;
        }
        store::set_body(tx.sql(), item.id, &item.body)?;
        let changed = Fact::ToolChanged {
            item: item.id,
            title: None,
            status: Some(ended),
            content: None,
            exit: None,
        };
        emit(tx, agent, thread, &changed)?;
    }
    questions::close_crew(tx, agent, thread, now.id)?;
    let fact = Fact::CrewEnded {
        crew: now.id,
        turn: now.turn,
        state: now.state,
        why: now.why.clone(),
        result: now.result.clone(),
        log: (now.log != was.log).then(|| now.log.clone()).flatten(),
        tokens: now.tokens,
        ended: now.ended.unwrap_or(now.started),
    };
    emit(tx, agent, thread, &fact)?;
    Ok(now)
}

/// Banda restarted: every Crew that was at work is Lost, with its calls
/// and Questions. Called as the Project opens, before anything runs.
pub fn lost(tx: &mut Tx<'_>) -> Result<(), Error> {
    for (thread, was) in store::every_crew_at_work(tx.sql())? {
        let Some(agent) = store::agent_of(tx.sql(), thread)? else {
            continue;
        };
        let now = Crew {
            state: CrewState::Lost,
            why: Some(RESTARTED.to_owned()),
            ..was
        };
        end(tx, Participant::Agent(agent), thread, now)?;
    }
    Ok(())
}

/// Claude went on by itself in `turn` of `thread` with the end of the
/// task run `run`: when that is a Crew's, it names the turn (ADR 0103,
/// decision 19), once.
pub fn went_on(tx: &mut Tx<'_>, thread: ThreadId, run: &str, turn: TurnId) -> Result<(), Error> {
    let Some(mut crew) = store::crew_of_run(tx.sql(), thread, run)? else {
        return Ok(());
    };
    let Some(agent) = store::agent_of(tx.sql(), thread)? else {
        return Ok(());
    };
    if crew.went_on.is_some() {
        return Ok(());
    }
    crew.went_on = Some(turn);
    store::set_crew(tx.sql(), &crew)?;
    let fact = Fact::CrewProgressed {
        crew: crew.id,
        phases: None,
        agents: Vec::new(),
        log: None,
        tokens: None,
        went_on: Some(turn),
    };
    emit(tx, Participant::Agent(agent), thread, &fact)
}

/// What a Crew's task ending as `end` makes of it.
fn ended_as(end: Option<TaskEnd>) -> CrewState {
    match end {
        Some(TaskEnd::Completed) | None => CrewState::Done,
        Some(TaskEnd::Failed) => CrewState::Failed,
        Some(TaskEnd::Stopped) => CrewState::Stopped,
    }
}

/// Why a Crew Banda cut off is Lost (ADR 0103, decision 3).
fn cut_words(cut: &Cut, harness: &str) -> String {
    match cut {
        Cut::Trust => "Stopped when you changed the Project's trust.".to_owned(),
        Cut::Account => format!("Stopped when {harness}'s account changed."),
        Cut::Moved(to) => format!("Stopped when the Thread moved to {to}."),
    }
}

/// The most of a Crew's output file Banda reads: Claude writes there its
/// whole tree beside its result, more than the Result keeps.
const OUTPUT: u64 = 4 * 1024 * 1024;

/// What a Crew left as it ended, read once from its output file.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Left {
    /// Its Result, at most [`RESULT`] bytes, cut where a character ends.
    pub result: Option<String>,
    /// The last line its script logged, which no frame carries while it
    /// works.
    pub log: Option<String>,
}

/// What Crew's output file `output` holds: Claude's object of its `result`
/// and `logs` (`tests/recordings/claude-crew.jsonl`), or else its text as
/// it is. Nothing when there is no file or nothing in it.
pub async fn left_in(output: &Path) -> Left {
    let Ok(file) = tokio::fs::File::open(output).await else {
        return Left::default();
    };
    let mut bytes = Vec::new();
    if file.take(OUTPUT).read_to_end(&mut bytes).await.is_err() {
        return Left::default();
    }
    let text = String::from_utf8_lossy(&bytes);
    let (result, log) = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Object(left)) => {
            let result = match left.get("result") {
                None | Some(serde_json::Value::Null) => None,
                Some(serde_json::Value::String(said)) => Some(said.clone()),
                Some(other) => serde_json::to_string_pretty(other).ok(),
            };
            let logs = left.get("logs").and_then(serde_json::Value::as_array);
            let last = logs.and_then(|logs| logs.iter().rev().find_map(serde_json::Value::as_str));
            (result, last.map(str::to_owned))
        }
        _ => (Some(text.into_owned()), None),
    };
    Left {
        result: result
            .map(capped)
            .filter(|result| !result.trim().is_empty()),
        log,
    }
}

/// `text` cut to at most [`RESULT`] bytes, where a character ends.
fn capped(mut text: String) -> String {
    let mut at = text.len().min(RESULT as usize);
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    text.truncate(at);
    text
}

/// Who hears a Thread's Crews.
pub struct Hearer {
    pub live: Arc<Live>,
    pub project: ModuleProject,
    pub thread: ThreadId,
    pub agent: AgentId,
    /// Its Harness's name, for plain words.
    pub harness: String,
}

/// One Crew at work, as its Hearer holds it.
struct Track {
    /// It as kept.
    record: Crew,
    /// How its task ended, once Claude said, before it said what it left.
    ending: Option<TaskEnd>,
    /// Held while it works.
    run: Option<CrewRun>,
    /// What writes its agents' calls and Questions between turns.
    transcript: Transcript,
}

impl Hearer {
    /// Hears the Crews of `session` from now on, unless someone already
    /// does. It stops when the session closes or the Harness is gone, and
    /// never keeps a session that is let go.
    pub fn hear(self, session: &acp::Session) {
        let Some(hear) = session.crews() else {
            return;
        };
        tokio::spawn(self.listen(session.downgrade(), hear));
    }

    async fn listen(self, session: acp::WeakSession, mut hear: mpsc::UnboundedReceiver<CrewSaid>) {
        let mut crews: HashMap<String, Track> = HashMap::new();
        while let Some(said) = hear.recv().await {
            if let Some(session) = session.upgrade() {
                session.touch();
            }
            if let Err(error) = self.heard(&session, &mut crews, said).await {
                tracing::warn!(%error, "what a Crew did could not be written");
            }
        }
        // The Harness says no more of them: those still at work are Lost.
        for (_, track) in crews {
            let why = match self.live.crew_cut(track.record.id) {
                Some(cut) => cut_words(&cut, &self.harness),
                None => format!("{} stopped while it worked.", self.harness),
            };
            let now = Crew {
                state: CrewState::Lost,
                why: Some(why),
                ..track.record.clone()
            };
            if let Err(error) = self.end(track, now).await {
                tracing::warn!(%error, "a Crew's end could not be written");
            }
        }
    }

    async fn heard(
        &self,
        session: &acp::WeakSession,
        crews: &mut HashMap<String, Track>,
        said: CrewSaid,
    ) -> Result<(), String> {
        match said {
            CrewSaid::Raw(Sdk::Started(started)) if started.kind == TaskKind::Workflow => {
                if crews.contains_key(&started.task) {
                    return Ok(());
                }
                if let Some(track) = self.start(session, &started).await? {
                    crews.insert(started.task.clone(), track);
                }
                Ok(())
            }
            CrewSaid::Raw(Sdk::Progress(progress)) => {
                let Some(track) = crews.get_mut(&progress.task) else {
                    return Ok(());
                };
                let now = progressed(&track.record, &progress);
                let (thread, agent) = (self.thread, Participant::Agent(self.agent));
                let was = track.record.clone();
                let kept = now.clone();
                let written = self
                    .project
                    .write(move |tx| keep_progress(tx, agent, thread, &was, &kept))
                    .await
                    .map_err(plain)?;
                if written {
                    track.record = now;
                } else {
                    // Its tokens move with it, written with the next change.
                    track.record.tokens = now.tokens;
                }
                Ok(())
            }
            CrewSaid::Raw(Sdk::Updated { task, end }) => {
                if let Some(track) = crews.get_mut(&task)
                    && end.is_some()
                {
                    track.ending = end;
                }
                Ok(())
            }
            CrewSaid::Raw(Sdk::Notified(notified)) => {
                let Some(track) = crews.remove(&notified.task) else {
                    return Ok(());
                };
                self.notified(track, notified).await
            }
            // A Crew whose task left the list once it ended, with no word
            // of what it left, ends as it said.
            CrewSaid::Raw(Sdk::Background(tasks)) => {
                let gone: Vec<String> = (crews.iter())
                    .filter(|(task, track)| {
                        track.ending.is_some() && !tasks.iter().any(|one| one.task == **task)
                    })
                    .map(|(task, _)| task.clone())
                    .collect();
                for task in gone {
                    let track = crews.remove(&task).expect("listed above");
                    let now = Crew {
                        state: ended_as(track.ending),
                        ..track.record.clone()
                    };
                    self.end(track, now).await?;
                }
                Ok(())
            }
            CrewSaid::Raw(_) => Ok(()),
            CrewSaid::Said { task, said } => {
                let Some(track) = crews.get_mut(&task) else {
                    // Nobody keeps that Crew: what it asks goes unanswered.
                    return Ok(());
                };
                let holder = Holder::Crew(track.run.as_ref());
                track.transcript.hear(holder, said).await?;
                track.transcript.write_gathered().await
            }
        }
    }

    /// Keeps the Crew Claude's task `started` is, in the Thread's latest
    /// turn, where Claude started it, and holds it while it works.
    async fn start(
        &self,
        session: &acp::WeakSession,
        started: &Started,
    ) -> Result<Option<Track>, String> {
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        let begun = started.clone();
        let kept = self
            .project
            .write(move |tx| {
                let Some(latest) = store::last_begun(tx.sql(), thread)? else {
                    return Ok(None);
                };
                let crew = crate::crews::started(&begun, latest.turn, tx.now());
                let ids = (begun.task.as_str(), begun.run.as_deref());
                start(tx, agent, thread, crew, ids).map(Some)
            })
            .await
            .map_err(plain)?;
        let Some(record) = kept else {
            tracing::warn!("a Crew started in a Thread with no turn");
            return Ok(None);
        };
        if !record.state.works() {
            return Ok(None);
        }
        let session = session.upgrade();
        let native = session
            .as_ref()
            .is_some_and(|session| session.running().native);
        let run = session.map(|session| {
            self.live
                .crew(self.project.id(), self.thread, record.id, &session)
        });
        let transcript = Transcript::crew(
            self.project.clone(),
            self.thread,
            self.agent,
            record.turn,
            record.id,
            self.harness.clone(),
            native,
        );
        Ok(Some(Track {
            record,
            ending: None,
            run,
            transcript,
        }))
    }

    /// Its task ended, as `notified` says, with what it left.
    async fn notified(&self, track: Track, notified: Notified) -> Result<(), String> {
        let state = ended_as(notified.end.or(track.ending));
        let left = match &notified.output {
            Some(output) => left_in(Path::new(output)).await,
            None => Left::default(),
        };
        // Its first line: a script that threw says where after it.
        let why = match state {
            CrewState::Failed => (notified.summary.as_deref())
                .and_then(|summary| summary.lines().next())
                .map(str::to_owned),
            _ => None,
        };
        let now = Crew {
            state,
            why,
            result: left.result,
            log: left.log.or_else(|| track.record.log.clone()),
            tokens: notified.tokens.or(track.record.tokens),
            ..track.record.clone()
        };
        self.end(track, now).await
    }

    /// Ends Crew `track` as `now`: what its agents said is written first,
    /// then its end, which ends its open calls and closes its Questions;
    /// then lets it go.
    async fn end(&self, mut track: Track, now: Crew) -> Result<(), String> {
        if let Err(error) = track.transcript.close().await {
            tracing::warn!(%error, "what a Crew's agents said could not be written");
        }
        let (thread, agent) = (self.thread, Participant::Agent(self.agent));
        let ended = self
            .project
            .write(move |tx| end(tx, agent, thread, now))
            .await
            .map_err(plain);
        drop(track.run.take());
        ended.map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Phase, SubagentState};

    fn agent(phase: u16, index: u32, state: SubagentState) -> CrewAgent {
        CrewAgent {
            index,
            label: format!("agent {phase}.{index}"),
            phase,
            state,
            model: None,
            attempt: 1,
            tokens: None,
            calls: None,
            took: None,
            started: (state != SubagentState::Queued)
                .then_some(i64::from(phase) * 100 + i64::from(index)),
            prompt: None,
            result: None,
            last: None,
            why: None,
            lane: None,
        }
    }

    fn crew() -> Crew {
        Crew {
            id: CrewId::new(),
            turn: TurnId::new(),
            title: "audit-routes".to_owned(),
            description: None,
            phases: ["Scan", "Fix", "Verify"]
                .iter()
                .enumerate()
                .map(|(at, title)| Phase {
                    index: at as u16 + 1,
                    title: (*title).to_owned(),
                    detail: Some(format!("{title} it")),
                })
                .collect(),
            agents: Vec::new(),
            state: CrewState::Working,
            why: None,
            started: 0,
            ended: None,
            tokens: None,
            log: None,
            script: None,
            result: None,
            went_on: None,
        }
    }

    fn tree(agents: Vec<CrewAgent>, tokens: u64) -> Progress {
        Progress {
            task: "t".to_owned(),
            tokens: Some(tokens),
            tree: Some(acp::Tree {
                phases: ["Scan", "Fix", "Verify"]
                    .iter()
                    .enumerate()
                    .map(|(at, title)| Phase {
                        index: at as u16 + 1,
                        title: (*title).to_owned(),
                        detail: None,
                    })
                    .collect(),
                agents,
                log: None,
            }),
        }
    }

    #[test]
    fn a_crew_is_written_only_when_an_agent_a_phase_a_count_or_the_log_changes() {
        use SubagentState::{Done, Queued, Running};
        let was = crew();
        // Its first agent: a count changed.
        let first = progressed(&was, &tree(vec![agent(1, 1, Running)], 10));
        let Some(Fact::CrewProgressed {
            agents,
            phases,
            tokens,
            ..
        }) = progress(&was, &first)
        else {
            panic!("a change");
        };
        assert_eq!(agents.len(), 1);
        assert_eq!(phases, None, "the script's phases, with their details kept");
        assert_eq!(first.phases[0].detail.as_deref(), Some("Scan it"));
        assert_eq!(tokens, Some(10));
        // Only tokens and times moved: nothing is written.
        let mut busier = agent(1, 1, Running);
        busier.tokens = Some(500);
        busier.took = Some(9);
        let same = progressed(&first, &tree(vec![busier], 900));
        assert_eq!(progress(&first, &same), None);
        assert_eq!(same.tokens, Some(900));
        // One ends and two more are called, one queued: only those go.
        let next = progressed(
            &same,
            &tree(
                vec![agent(1, 1, Done), agent(2, 1, Running), agent(2, 2, Queued)],
                1000,
            ),
        );
        let Some(Fact::CrewProgressed { agents, .. }) = progress(&same, &next) else {
            panic!("a change");
        };
        let moved: Vec<_> = agents.iter().map(|a| (a.phase, a.index, a.state)).collect();
        assert_eq!(moved, [(1, 1, Done), (2, 1, Running), (2, 2, Queued)]);
        // The log line alone is a change.
        let mut logged = next.clone();
        logged.log = Some("scanned".to_owned());
        let Some(Fact::CrewProgressed { agents, log, .. }) = progress(&next, &logged) else {
            panic!("a change");
        };
        assert!(agents.is_empty());
        assert_eq!(log.as_deref(), Some("scanned"));
    }

    #[test]
    fn a_frame_without_a_tree_keeps_the_crew_and_its_tokens_move() {
        let mut was = crew();
        was.agents = vec![agent(1, 1, SubagentState::Running)];
        let now = progressed(
            &was,
            &Progress {
                task: "t".to_owned(),
                tokens: Some(42),
                tree: None,
            },
        );
        assert_eq!(now.agents, was.agents);
        assert_eq!(now.tokens, Some(42));
        assert_eq!(progress(&was, &now), None);
    }

    #[test]
    fn a_list_names_the_phase_of_the_agent_that_started_last() {
        use SubagentState::{Done, Queued, Running};
        let mut crew = crew();
        assert_eq!(
            brief(&crew),
            CrewBrief {
                title: "audit-routes".to_owned(),
                phase: "Scan".to_owned(),
                done: 0,
                of: 0
            }
        );
        crew.agents = vec![
            agent(1, 1, Done),
            agent(1, 2, Done),
            agent(2, 1, Done),
            agent(2, 2, Running),
            agent(2, 3, Queued),
        ];
        let brief = brief(&crew);
        assert_eq!((brief.phase.as_str(), brief.done, brief.of), ("Fix", 1, 3));
    }

    #[test]
    fn a_workflow_without_meta_is_named_by_claude() {
        let started = Started {
            task: "t".to_owned(),
            run: None,
            tool_use: None,
            kind: TaskKind::Workflow,
            name: None,
            description: Some("Read two files".to_owned()),
            prompt: Some("phase('Read')".to_owned()),
            background: false,
            parent: None,
            ambient: false,
        };
        let crew = super::started(&started, TurnId::new(), 7);
        assert_eq!(crew.title, "Read two files");
        assert!(crew.phases.is_empty());
        assert_eq!((crew.state, crew.started), (CrewState::Working, 7));
    }

    #[tokio::test]
    async fn a_result_is_what_claudes_output_file_says_it_returned_at_most_64_kb() {
        let folder = tempfile::tempdir().unwrap();
        let output = folder.path().join("t.output");
        let left = async || left_in(&output).await;
        assert_eq!(left().await, Left::default(), "no file");
        std::fs::write(&output, "").unwrap();
        assert_eq!(left().await, Left::default(), "a script that threw");
        // Claude's object: what it returned, and the lines it logged.
        let said = serde_json::json!({
            "summary": "Read", "agentCount": 2, "logs": ["scanned 2 files", "verified"],
            "result": "alpha, bravo; done", "workflowProgress": [],
        });
        std::fs::write(&output, said.to_string()).unwrap();
        let read = left().await;
        assert_eq!(read.result.as_deref(), Some("alpha, bravo; done"));
        assert_eq!(read.log.as_deref(), Some("verified"));
        // A value not a string, as a script may return, is written out.
        std::fs::write(&output, r#"{"result": {"n": 2}}"#).unwrap();
        assert_eq!(left().await.result.as_deref(), Some("{\n  \"n\": 2\n}"));
        // Any other text is its Result as it is, cut at 64 KB where a
        // character ends.
        std::fs::write(&output, "apple banana").unwrap();
        assert_eq!(left().await.result.as_deref(), Some("apple banana"));
        let long = "é".repeat(40 * 1024);
        std::fs::write(&output, &long).unwrap();
        let read = left().await.result.unwrap();
        assert_eq!(read.len(), 64 * 1024);
        assert!(long.starts_with(&read));
    }
}
