//! What each Thread's running turn does now (ADR 0099, decision 11),
//! folded from the turn's events as its Harness says them: a tool call of
//! its kind and what it works on, a thought, or the reply; when the turn
//! last said anything, a sub-agent's words too; whether its Harness
//! compacts the context; and when a usage limit it waits on lets it go on.
//!
//! Only memory holds it, as it holds the turns: a turn's goes as the turn
//! ends, and a restart forgets all. It is no fact, since at ten Agents a
//! fact a second would be some 36,000 rows an hour in the log.
//! `agents.doing` says it to a window: all of a Project's at once, then
//! each Thread's as it changes, no more than once a second, and
//! `agents.threads` lists it with each Thread.

use crate::acp::{Said, ToolPart, unstarted};
use crate::model::{ThreadId, ToolKind, ToolStatus, TurnId};
use crate::touching::{ByProject, Place, diffed};
use banda_kernel::{ProjectId, Stream};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::Instant;
use ts_rs::TS;

/// How often a Thread's doing is said at most, in milliseconds: a change
/// waits a second from the first one not yet said. A tool call is said
/// only once it ran that long, so one shorter is folded into what follows
/// it.
pub const EVERY: i64 = 1000;

/// What a running turn does: a tool call of its kind, thinking, or writing
/// its reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum DoingKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    Other,
    Reply,
}

impl From<ToolKind> for DoingKind {
    fn from(kind: ToolKind) -> DoingKind {
        match kind {
            ToolKind::Read => DoingKind::Read,
            ToolKind::Edit => DoingKind::Edit,
            ToolKind::Delete => DoingKind::Delete,
            ToolKind::Move => DoingKind::Move,
            ToolKind::Search => DoingKind::Search,
            ToolKind::Execute => DoingKind::Execute,
            ToolKind::Think => DoingKind::Think,
            ToolKind::Fetch => DoingKind::Fetch,
            ToolKind::Other => DoingKind::Other,
        }
    }
}

/// What a Thread's running turn does now, and since when.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Doing {
    pub what: DoingKind,
    /// What it works on, in a few words for its card: the command, the
    /// file's base name, the query or the host; else its tool's title. At
    /// most 60 characters. None while it thinks or writes its reply.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// When it began, in milliseconds since the epoch.
    #[ts(type = "number")]
    pub since: i64,
}

/// What a Thread does while a turn of its runs (ADR 0099, decision 11):
/// none of it while none runs.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct DoingNow {
    /// What its turn does now, and since when.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doing: Option<Doing>,
    /// When its turn last said anything, a sub-agent's words too, in
    /// milliseconds since the epoch; the turn's start until it says
    /// something. A window tells by it that an Agent is stuck.
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stepped: Option<i64>,
    /// Its Harness compacts the context now.
    #[ts(as = "Option<bool>", optional)]
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub compacting: bool,
    /// When a usage limit the turn waits on lets it go on, in
    /// milliseconds since the epoch. Only a turn that runs waits so: one
    /// that failed on its limit says it as it ended (`Failure`).
    #[ts(optional, type = "number")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_until: Option<i64>,
}

/// One Thread's in `agents.doing`; nothing but its ID once its turn ended.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ThreadDoing {
    pub thread: ThreadId,
    #[serde(flatten)]
    pub now: DoingNow,
}

/// What `agents.doing` says: first what every Thread at work in the
/// Project does, then, as each changes, that Thread's.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ThreadsDoing {
    /// Whether these are all the Threads at work, as in the first piece: a
    /// window forgets what it held of any other.
    pub all: bool,
    pub threads: Vec<ThreadDoing>,
}

/// One of a turn's events, as the fold takes it.
#[derive(Debug)]
pub enum Step<'a> {
    /// A piece of the Agent's reply.
    Reply,
    /// A piece of its thinking.
    Thought,
    /// A tool call started.
    Started(Started<'a>),
    /// A tool call changed: its title and status, when said, and the file
    /// it names now.
    Changed {
        call: &'a str,
        title: Option<&'a str>,
        status: Option<ToolStatus>,
        file: Option<&'a str>,
    },
    /// The Harness waits on a usage limit that lets it go on then.
    Limited(i64),
    /// Anything else it said: a Question, a plan, a notice, what it used.
    Said,
}

/// A tool call that started: its kind, title and status as its Harness
/// says them, and the file it names; `compacts` when it is the Harness
/// compacting the context, as Claude Code's adapter says it.
#[derive(Debug)]
pub struct Started<'a> {
    pub call: &'a str,
    pub kind: ToolKind,
    pub title: &'a str,
    pub file: Option<&'a str>,
    pub status: ToolStatus,
    pub compacts: bool,
}

/// `said` as the fold takes it.
pub fn step(said: &Said) -> Step<'_> {
    match said {
        Said::Reply { .. } => Step::Reply,
        Said::Thought { .. } => Step::Thought,
        Said::ToolStarted {
            call,
            title,
            tool,
            status,
            content,
            places,
            compacts,
        } => Step::Started(Started {
            call,
            kind: *tool,
            title,
            file: named(places, content),
            status: *status,
            compacts: *compacts,
        }),
        Said::ToolChanged {
            call,
            change,
            places,
            ..
        } => Step::Changed {
            call,
            title: change.title.as_deref(),
            status: change.status,
            file: named(places, change.content.as_deref().unwrap_or_default()),
        },
        Said::Used {
            resets: Some(until),
            ..
        } => Step::Limited(*until),
        _ => Step::Said,
    }
}

/// The file a tool call names first, else the file its diff changes.
fn named<'a>(places: &'a [Place], parts: &'a [ToolPart]) -> Option<&'a str> {
    let mut place = places.iter().map(|place| place.path.as_str());
    let diff = || diffed(parts.iter().filter_map(ToolPart::shown));
    place.find(|path| !path.is_empty()).or_else(diff)
}

/// What a tool call of `kind` titled `title`, naming `file`, works on, in
/// a few words (ADR 0098, decision 8): the file's base name for a read,
/// an edit, a delete or a move; the query of a search; the host of a
/// fetch, or the query of a web search; else its title, which is the
/// command of Claude Code's and Codex's commands. One line, cut as a
/// Thread's title is, to 60 characters; none when that says nothing.
pub fn target(kind: ToolKind, title: &str, file: Option<&str>) -> Option<String> {
    let said = match kind {
        ToolKind::Read | ToolKind::Edit | ToolKind::Delete | ToolKind::Move => file.map(base_name),
        ToolKind::Search => query(title),
        ToolKind::Fetch => host(title).or_else(|| query(title)),
        ToolKind::Execute | ToolKind::Think | ToolKind::Other => None,
    };
    let said = said.unwrap_or(title);
    (!said.trim().is_empty()).then(|| crate::rules::message::title(said, &[]))
}

/// The last part of `path`, by either kind of slash.
fn base_name(path: &str) -> &str {
    let mut parts = path.rsplit(['/', '\\']);
    parts.find(|part| !part.is_empty()).unwrap_or(path)
}

/// What a search looks for: the first text in double quotes, as Claude
/// Code's grep and web search title it, else the last in backticks, as its
/// glob does. Quotes right after a `=` hold an option's value, as grep's
/// `--include="*.rs"` before its pattern, so they are passed over.
fn query(title: &str) -> Option<&str> {
    let mut rest = title;
    let quoted = loop {
        let Some((before, after)) = rest.split_once('"') else {
            break None;
        };
        let Some((inside, next)) = after.split_once('"') else {
            break None;
        };
        if !before.ends_with('=') {
            break Some(inside);
        }
        rest = next;
    };
    let ticked = (title.rsplit_once('`')).and_then(|(rest, _)| rest.rsplit_once('`'));
    let found = quoted.or(ticked.map(|(_, query)| query));
    found.filter(|query| !query.trim().is_empty())
}

/// The host of the first address `title` names.
fn host(title: &str) -> Option<&str> {
    let (_, rest) = title.split_once("://")?;
    let host = rest.split(['/', '?', '#', ' ', ')']).next()?;
    (!host.is_empty()).then_some(host)
}

/// A tool call that runs, as the fold keeps it.
struct Call {
    id: String,
    kind: ToolKind,
    title: String,
    file: Option<String>,
    doing: Doing,
}

/// Whether a tool call of `status` still runs.
fn runs(status: ToolStatus) -> bool {
    matches!(status, ToolStatus::Pending | ToolStatus::Running)
}

/// One running turn's events, folded into what it does now, and what of
/// that is said, no more than once each [`EVERY`]. Times are in
/// milliseconds since the epoch, as each event comes.
pub struct Fold {
    now: DoingNow,
    said: DoingNow,
    /// When the first change not yet said came; none while what was said
    /// is what is so.
    waits: Option<i64>,
    /// The tool calls that run, the first started first.
    calls: Vec<Call>,
    /// Every tool call that started in the turn, by its Harness's ID.
    seen: HashSet<String>,
    /// The tool call shown as what it does; none while it thinks or
    /// writes its reply.
    shown: Option<String>,
    /// The tool call in which its Harness compacts the context, while it
    /// runs.
    compaction: Option<String>,
}

impl Fold {
    /// A turn that began at `at`, as said then.
    pub fn new(at: i64) -> Fold {
        let now = DoingNow {
            stepped: Some(at),
            ..DoingNow::default()
        };
        Fold {
            said: now.clone(),
            now,
            waits: None,
            calls: Vec::new(),
            seen: HashSet::new(),
            shown: None,
            compaction: None,
        }
    }

    /// What it does now, as its events say.
    pub fn now(&self) -> &DoingNow {
        &self.now
    }

    pub fn hear(&mut self, step: Step<'_>, at: i64) {
        self.now.stepped = Some(at);
        match step {
            Step::Reply => self.works(DoingKind::Reply, at),
            Step::Thought => self.works(DoingKind::Think, at),
            Step::Started(started) => self.started(started, at),
            Step::Changed {
                call,
                title,
                status,
                file,
            } => self.changed(call, title, status, file, at),
            Step::Limited(until) => self.now.limit_until = Some(until),
            Step::Said => {}
        }
        self.waits = (self.now != self.said).then(|| self.waits.unwrap_or(at));
    }

    /// What to say at `at`: what it does now, once a change waited its
    /// second; none before, or while nothing changed.
    pub fn say(&mut self, at: i64) -> Option<DoingNow> {
        let since = self.waits?;
        if at < since + EVERY {
            return None;
        }
        let mut said = self.now.clone();
        // A tool call that runs for less than its second yet is folded
        // into what follows it: what it does stays as it was said, the
        // rest is said now, and the call a second later if it still shows,
        // so changes stay a second apart.
        let young = self.shown.is_some()
            && (self.now.doing.as_ref()).is_some_and(|doing| at - doing.since < EVERY);
        if young {
            said.doing.clone_from(&self.said.doing);
        }
        self.waits = young.then_some(at);
        if said == self.said {
            return None;
        }
        self.said = said;
        Some(self.said.clone())
    }

    /// When the change that waits may be said; none while none waits.
    pub fn due(&self) -> Option<i64> {
        self.waits.map(|since| since + EVERY)
    }

    /// It thinks or writes its reply, which ends what it compacted or
    /// waited on.
    fn works(&mut self, what: DoingKind, at: i64) {
        self.shown = None;
        self.goes_on();
        self.show(Doing {
            what,
            title: None,
            since: at,
        });
    }

    fn started(&mut self, started: Started<'_>, at: i64) {
        let Started {
            call,
            kind,
            title,
            file,
            status,
            compacts,
        } = started;
        self.seen.insert(call.to_owned());
        if compacts {
            // A compaction is no doing of its own: the card says it above
            // the doing, which it leaves as it was.
            if runs(status) {
                self.compaction = Some(call.to_owned());
                self.now.compacting = true;
            }
            return;
        }
        let doing = Doing {
            what: kind.into(),
            title: target(kind, title, file),
            since: at,
        };
        if runs(status) {
            self.calls.push(Call {
                id: call.to_owned(),
                kind,
                title: title.to_owned(),
                file: file.map(str::to_owned),
                doing: doing.clone(),
            });
        }
        self.shown = Some(call.to_owned());
        self.goes_on();
        self.show(doing);
    }

    fn changed(
        &mut self,
        call: &str,
        title: Option<&str>,
        status: Option<ToolStatus>,
        file: Option<&str>,
        at: i64,
    ) {
        let ended = status.is_some_and(|status| !runs(status));
        if self.compaction.as_deref() == Some(call) {
            if ended {
                self.compaction = None;
                self.now.compacting = false;
            }
            return;
        }
        if !self.seen.contains(call) {
            // A call it never said started, as the Thread shows it.
            let (kind, title, status) = unstarted(title, status);
            let started = Started {
                call,
                kind,
                title,
                file,
                status,
                compacts: false,
            };
            self.started(started, at);
            return;
        }
        // What a command prints, or a call that moves on to running,
        // changes nothing it does.
        if title.is_none() && file.is_none() && !ended {
            return;
        }
        // One that ended already changes nothing it does.
        let Some(index) = self.calls.iter().position(|one| one.id == call) else {
            return;
        };
        let one = &mut self.calls[index];
        if let Some(title) = title {
            title.clone_into(&mut one.title);
        }
        if let Some(file) = file {
            one.file = Some(file.to_owned());
        }
        one.doing.title = target(one.kind, &one.title, one.file.as_deref());
        let shown = self.shown.as_deref() == Some(call);
        if shown {
            self.now.doing = Some(one.doing.clone());
        }
        if !ended {
            return;
        }
        self.calls.remove(index);
        if !shown {
            return;
        }
        // What it showed ended: it does the latest call that still runs,
        // else its model weighs what came back.
        match self.calls.last() {
            Some(last) => {
                self.shown = Some(last.id.clone());
                self.now.doing = Some(last.doing.clone());
            }
            None => {
                self.shown = None;
                self.show(Doing {
                    what: DoingKind::Think,
                    title: None,
                    since: at,
                });
            }
        }
    }

    /// It does `doing` now; the same kind on the same thing keeps the
    /// time it began.
    fn show(&mut self, doing: Doing) {
        let same = (self.now.doing.as_ref())
            .is_some_and(|now| now.what == doing.what && now.title == doing.title);
        if !same {
            self.now.doing = Some(doing);
        }
    }

    /// The Agent does something new: no compaction runs, and no limit
    /// holds it.
    fn goes_on(&mut self) {
        self.compaction = None;
        self.now.compacting = false;
        self.now.limit_until = None;
    }
}

/// The Threads of a Project at work, each with its running turn and what
/// that does as last said.
pub type AtWork = BTreeMap<ThreadId, (TurnId, DoingNow)>;

/// What every Project's running turns do now, as last said, and who hears
/// it.
#[derive(Default)]
pub struct Doings {
    projects: ByProject<AtWork>,
}

impl Doings {
    /// `turn` of `thread` began: it is what the Thread does now, whatever
    /// turn of it ran before.
    pub fn set(&self, project: ProjectId, thread: ThreadId, turn: TurnId, now: DoingNow) {
        self.projects.of(project).send_modify(|all| {
            all.insert(thread, (turn, now));
        });
    }

    /// `turn` of `thread` does `now`, unless its Thread's next turn began
    /// already: one handed over still says what it heard before it ends.
    pub fn update(&self, project: ProjectId, thread: ThreadId, turn: TurnId, now: DoingNow) {
        self.projects
            .of(project)
            .send_if_modified(|all| match all.get_mut(&thread) {
                Some((of, was)) if *of == turn => {
                    *was = now;
                    true
                }
                _ => false,
            });
    }

    /// `turn` of `thread` ended: the Thread does nothing, unless its next
    /// turn began already.
    pub fn end(&self, project: ProjectId, thread: ThreadId, turn: TurnId) {
        self.projects.of(project).send_if_modified(|all| {
            let ended = all.get(&thread).is_some_and(|(of, _)| *of == turn);
            if ended {
                all.remove(&thread);
            }
            ended
        });
    }

    /// What each of `project`'s Threads at work does now, and in which
    /// turn.
    pub fn now(&self, project: ProjectId) -> AtWork {
        self.projects.of(project).borrow().clone()
    }

    /// What `project`'s Threads do now, then each Thread's again as it
    /// changes, until the one hearing lets go. One slow to hear skips to
    /// what is so when it hears again.
    pub fn hear(&self, project: ProjectId) -> Stream {
        // What this one was told, by Thread.
        let mut told = BTreeMap::new();
        let mut all = true;
        self.projects.hear(project, move |at_work| {
            let now: BTreeMap<_, _> = (at_work.iter())
                .map(|(thread, (_, now))| (*thread, now.clone()))
                .collect();
            let threads = news(&told, &now);
            let said = all || !threads.is_empty();
            let piece = said.then(|| serde_json::to_value(ThreadsDoing { all, threads }));
            (told, all) = (now, false);
            piece.and_then(Result::ok)
        })
    }
}

/// What changed from `told` to `now`: each Thread that does something new,
/// then each whose turn ended, with nothing.
fn news(
    told: &BTreeMap<ThreadId, DoingNow>,
    now: &BTreeMap<ThreadId, DoingNow>,
) -> Vec<ThreadDoing> {
    let changed = (now.iter())
        .filter(|(thread, now)| told.get(thread) != Some(now))
        .map(|(thread, now)| ThreadDoing {
            thread: *thread,
            now: now.clone(),
        });
    let ended = (told.keys())
        .filter(|thread| !now.contains_key(thread))
        .map(|thread| ThreadDoing {
            thread: *thread,
            now: DoingNow::default(),
        });
    changed.chain(ended).collect()
}

/// What one running turn does, told to [`Doings`] as it begins and then as
/// it changes, no more than once each [`EVERY`]; let go as the turn ends,
/// its Thread does nothing.
pub struct Doer {
    doings: Arc<Doings>,
    project: ProjectId,
    thread: ThreadId,
    turn: TurnId,
    fold: Fold,
}

impl Doer {
    pub fn new(doings: Arc<Doings>, project: ProjectId, thread: ThreadId, turn: TurnId) -> Doer {
        let fold = Fold::new(banda_kernel::now_ms());
        doings.set(project, thread, turn, fold.now().clone());
        Doer {
            doings,
            project,
            thread,
            turn,
            fold,
        }
    }

    /// The Harness said `said` in the turn.
    pub fn hear(&mut self, said: &Said) {
        let at = banda_kernel::now_ms();
        self.fold.hear(step(said), at);
        self.say_at(at);
    }

    /// When what waits may be said; none while nothing waits.
    pub fn due(&self) -> Option<Instant> {
        let wait = self.fold.due()? - banda_kernel::now_ms();
        let wait = Duration::from_millis(u64::try_from(wait).unwrap_or(0));
        Some(Instant::now() + wait)
    }

    /// Says what waits, once its second is up.
    pub fn say(&mut self) {
        self.say_at(banda_kernel::now_ms());
    }

    fn say_at(&mut self, at: i64) {
        if let Some(now) = self.fold.say(at) {
            self.doings
                .update(self.project, self.thread, self.turn, now);
        }
    }
}

impl Drop for Doer {
    fn drop(&mut self) {
        self.doings.end(self.project, self.thread, self.turn);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn started<'a>(call: &'a str, kind: ToolKind, title: &'a str) -> Step<'a> {
        Step::Started(Started {
            call,
            kind,
            title,
            file: None,
            status: ToolStatus::Running,
            compacts: false,
        })
    }

    fn ended(call: &str) -> Step<'_> {
        Step::Changed {
            call,
            title: None,
            status: Some(ToolStatus::Done),
            file: None,
        }
    }

    fn doing(what: DoingKind, title: Option<&str>, since: i64) -> Option<Doing> {
        Some(Doing {
            what,
            title: title.map(str::to_owned),
            since,
        })
    }

    #[test]
    fn what_a_tool_call_works_on_is_its_file_command_query_or_host_in_a_few_words() {
        let cases = [
            (
                ToolKind::Read,
                "Read src/card.ts",
                Some("/w/src/card.ts"),
                Some("card.ts"),
            ),
            (
                ToolKind::Edit,
                "Edit",
                Some("C:\\w\\Row.tsx"),
                Some("Row.tsx"),
            ),
            // Without a file, its title.
            (ToolKind::Read, "List files", None, Some("List files")),
            (ToolKind::Execute, "pnpm test", None, Some("pnpm test")),
            (
                ToolKind::Execute,
                "cd w &&\n  pnpm  test",
                None,
                Some("cd w && pnpm test"),
            ),
            (
                ToolKind::Search,
                "grep -n \"standOf\" src",
                None,
                Some("standOf"),
            ),
            (
                ToolKind::Search,
                "grep -n --include=\"*.rs\" \"standOf\" src",
                None,
                Some("standOf"),
            ),
            (
                ToolKind::Search,
                "Find `src` `**/*.ts`",
                None,
                Some("**/*.ts"),
            ),
            (ToolKind::Search, "Search files", None, Some("Search files")),
            (
                ToolKind::Fetch,
                "Fetch https://docs.rs/tokio/latest",
                None,
                Some("docs.rs"),
            ),
            (
                ToolKind::Fetch,
                "Search \"tokio watch\"",
                None,
                Some("tokio watch"),
            ),
            (ToolKind::Fetch, "Fetch", None, Some("Fetch")),
            (
                ToolKind::Other,
                "Load skill: banda",
                None,
                Some("Load skill: banda"),
            ),
            (ToolKind::Other, "  ", None, None),
        ];
        for (kind, title, file, expected) in cases {
            assert_eq!(
                target(kind, title, file).as_deref(),
                expected,
                "{kind:?} {title}"
            );
        }
        let long = target(ToolKind::Execute, &"x".repeat(80), None).unwrap();
        assert_eq!(long.chars().count(), 60);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn the_fold_says_what_the_turn_does_by_its_events() {
        let mut fold = Fold::new(0);
        let doing_at = |fold: &Fold| fold.now().doing.clone();
        assert_eq!(fold.now().stepped, Some(0), "its start, until it says");
        assert_eq!(doing_at(&fold), None);

        // Each piece of a thought is the same thinking.
        fold.hear(Step::Thought, 10);
        fold.hear(Step::Thought, 20);
        assert_eq!(doing_at(&fold), doing(DoingKind::Think, None, 10));
        assert_eq!(fold.now().stepped, Some(20));

        // A read names its file once its Harness says it, as Claude
        // Code's does, and keeps the time it began.
        fold.hear(started("r", ToolKind::Read, "Read File"), 30);
        let named = Step::Changed {
            call: "r",
            title: Some("Read notes.txt"),
            status: None,
            file: Some("/w/notes.txt"),
        };
        fold.hear(named, 40);
        assert_eq!(
            doing_at(&fold),
            doing(DoingKind::Read, Some("notes.txt"), 30)
        );

        // Two calls at once: the latest shows, and as it ends, the other.
        fold.hear(started("x", ToolKind::Execute, "pnpm test"), 50);
        fold.hear(started("g", ToolKind::Search, "grep \"standOf\""), 60);
        assert_eq!(
            doing_at(&fold),
            doing(DoingKind::Search, Some("standOf"), 60)
        );
        fold.hear(ended("g"), 70);
        assert_eq!(
            doing_at(&fold),
            doing(DoingKind::Execute, Some("pnpm test"), 50)
        );
        // One not shown ends unseen.
        fold.hear(ended("r"), 75);
        assert_eq!(
            doing_at(&fold),
            doing(DoingKind::Execute, Some("pnpm test"), 50)
        );
        // The last ends: its model weighs what came back.
        fold.hear(ended("x"), 80);
        assert_eq!(doing_at(&fold), doing(DoingKind::Think, None, 80));

        // A call that ended as it started is what it did last.
        let done = Step::Started(Started {
            call: "e",
            kind: ToolKind::Edit,
            title: "Edit Row.tsx",
            file: Some("/w/Row.tsx"),
            status: ToolStatus::Done,
            compacts: false,
        });
        fold.hear(done, 90);
        assert_eq!(doing_at(&fold), doing(DoingKind::Edit, Some("Row.tsx"), 90));

        // A call it never said started shows as the Thread shows it.
        let unknown = Step::Changed {
            call: "u",
            title: None,
            status: None,
            file: None,
        };
        fold.hear(unknown, 95);
        assert_eq!(doing_at(&fold), doing(DoingKind::Other, Some("A tool"), 95));
        fold.hear(ended("u"), 97);

        fold.hear(Step::Reply, 100);
        assert_eq!(doing_at(&fold), doing(DoingKind::Reply, None, 100));

        // Anything else it says moves only `stepped`.
        fold.hear(Step::Said, 110);
        assert_eq!(doing_at(&fold), doing(DoingKind::Reply, None, 100));
        assert_eq!(fold.now().stepped, Some(110));
    }

    #[test]
    fn a_compaction_and_a_usage_limit_hold_until_the_agent_goes_on() {
        let mut fold = Fold::new(0);
        fold.hear(started("x", ToolKind::Execute, "pnpm test"), 10);
        let compacts = Step::Started(Started {
            call: "c",
            kind: ToolKind::Think,
            title: "Compact conversation",
            file: None,
            status: ToolStatus::Running,
            compacts: true,
        });
        fold.hear(compacts, 20);
        assert!(fold.now().compacting);
        assert_eq!(
            fold.now().doing,
            doing(DoingKind::Execute, Some("pnpm test"), 10),
            "it leaves the doing as it was"
        );
        fold.hear(ended("c"), 30);
        assert!(!fold.now().compacting);

        // One its Harness never ends goes as the Agent goes on.
        fold.hear(compacts_at("d"), 40);
        fold.hear(Step::Thought, 50);
        assert!(!fold.now().compacting);
        // One that ended as it was said runs no more.
        let compacted = Step::Started(Started {
            call: "e",
            kind: ToolKind::Think,
            title: "Compact conversation",
            file: None,
            status: ToolStatus::Done,
            compacts: true,
        });
        fold.hear(compacted, 55);
        assert!(!fold.now().compacting);

        fold.hear(Step::Limited(9_000), 60);
        assert_eq!(fold.now().limit_until, Some(9_000));
        fold.hear(Step::Said, 70);
        assert_eq!(fold.now().limit_until, Some(9_000), "it still waits");
        fold.hear(Step::Reply, 80);
        assert_eq!(fold.now().limit_until, None, "it went on");
    }

    fn compacts_at(call: &str) -> Step<'_> {
        Step::Started(Started {
            call,
            kind: ToolKind::Think,
            title: "Compact conversation",
            file: None,
            status: ToolStatus::Running,
            compacts: true,
        })
    }

    #[test]
    fn a_change_is_said_a_second_after_the_first_not_yet_said_with_what_is_so_then() {
        let mut fold = Fold::new(0);
        assert_eq!(fold.say(5_000), None, "nothing changed");
        fold.hear(started("r", ToolKind::Read, "Read a.ts"), 100);
        assert_eq!(fold.due(), Some(1_100));
        assert_eq!(fold.say(1_099), None);
        // A read shorter than its second is folded into what follows.
        fold.hear(ended("r"), 300);
        fold.hear(Step::Thought, 400);
        assert_eq!(fold.due(), Some(1_100), "the first change sets the time");
        let said = fold.say(1_100).unwrap();
        assert_eq!(said.doing, doing(DoingKind::Think, None, 300));
        assert_eq!(said.stepped, Some(400));
        assert_eq!((fold.due(), fold.say(1_200)), (None, None));

        // The next change waits its own second, so changes are a second
        // apart at least.
        fold.hear(Step::Said, 1_500);
        assert_eq!(fold.due(), Some(2_500));
        assert_eq!(fold.say(2_499), None);
        assert_eq!(fold.say(2_500).unwrap().stepped, Some(1_500));
    }

    #[test]
    fn a_tool_call_is_said_only_once_it_ran_its_second() {
        let mut fold = Fold::new(0);
        // A read that starts just before a change is due, and ends just
        // after: the rest is said then, and the read never.
        fold.hear(Step::Thought, 1_500);
        fold.hear(started("r", ToolKind::Read, "Read a.ts"), 2_450);
        let said = fold.say(2_500).unwrap();
        assert_eq!(said.doing, None, "what it does stays as it was said");
        assert_eq!(said.stepped, Some(2_450));
        assert_eq!(fold.due(), Some(3_500), "a second after what was said");
        fold.hear(ended("r"), 2_550);
        assert_eq!(fold.say(3_499), None);
        let said = fold.say(3_500).unwrap();
        assert_eq!(said.doing, doing(DoingKind::Think, None, 2_550));

        // One that still runs a second later is said then.
        fold.hear(Step::Said, 4_000);
        fold.hear(started("x", ToolKind::Execute, "pnpm test"), 4_900);
        let said = fold.say(5_000).unwrap();
        assert_eq!(said.doing, doing(DoingKind::Think, None, 2_550));
        assert_eq!(fold.say(5_999), None);
        let said = fold.say(6_000).unwrap();
        assert_eq!(
            said.doing,
            doing(DoingKind::Execute, Some("pnpm test"), 4_900)
        );
        assert_eq!(fold.due(), None);

        // A short call over one that runs on leaves that one as said.
        fold.hear(started("g", ToolKind::Search, "grep \"a\""), 6_500);
        fold.hear(ended("g"), 6_600);
        assert_eq!(
            fold.say(7_500).unwrap().doing,
            doing(DoingKind::Execute, Some("pnpm test"), 4_900)
        );
    }

    async fn next(stream: &mut Stream) -> Value {
        tokio::time::timeout(std::time::Duration::from_secs(5), stream.recv())
            .await
            .expect("a piece in time")
            .expect("the stream goes on")
    }

    #[tokio::test]
    async fn the_stream_says_every_thread_at_once_then_each_change_and_each_end() {
        let doings = Arc::new(Doings::default());
        let project = ProjectId::new();
        let (one, two) = (ThreadId::new(), ThreadId::new());
        let first = Doer::new(doings.clone(), project, one, TurnId::new());

        // A window that comes now hears what is so, all of it.
        let mut heard = doings.hear(project);
        let piece = next(&mut heard).await;
        assert_eq!(piece["all"], json!(true));
        assert_eq!(piece["threads"][0]["thread"], json!(one));
        assert!(piece["threads"][0]["stepped"].is_i64());
        assert!(piece["threads"][0].get("doing").is_none());

        // Then each Thread's as it changes, alone.
        let mut second = Doer::new(doings.clone(), project, two, TurnId::new());
        let piece = next(&mut heard).await;
        assert_eq!(piece["all"], json!(false));
        assert_eq!(piece["threads"].as_array().unwrap().len(), 1);
        assert_eq!(piece["threads"][0]["thread"], json!(two));
        let reading = Step::Started(Started {
            call: "r",
            kind: ToolKind::Read,
            title: "Read a.ts",
            file: Some("/w/a.ts"),
            status: ToolStatus::Running,
            compacts: false,
        });
        second.fold.hear(reading, banda_kernel::now_ms() - EVERY);
        second.say();
        let piece = next(&mut heard).await;
        let said = &piece["threads"][0];
        assert_eq!(
            (&said["thread"], &said["doing"]["what"]),
            (&json!(two), &json!("read"))
        );
        assert_eq!(said["doing"]["title"], json!("a.ts"));
        assert_eq!(
            doings.now(project)[&two].1.doing.as_ref().unwrap().what,
            DoingKind::Read
        );

        // A turn let go: its Thread comes with nothing, and lists nothing.
        drop(first);
        let piece = next(&mut heard).await;
        assert_eq!(
            piece,
            json!({ "all": false, "threads": [{ "thread": one }] })
        );
        assert!(!doings.now(project).contains_key(&one));

        // A later window hears all of it at once again.
        let mut later = doings.hear(project);
        let piece = next(&mut later).await;
        assert_eq!(piece["all"], json!(true));
        assert_eq!(piece["threads"].as_array().unwrap().len(), 1);
        assert_eq!(piece["threads"][0]["doing"]["what"], json!("read"));

        // Another Project hears none of it.
        let mut elsewhere = doings.hear(ProjectId::new());
        assert_eq!(
            next(&mut elsewhere).await,
            json!({ "all": true, "threads": [] })
        );
    }

    #[test]
    fn a_turn_that_ends_after_its_threads_next_began_leaves_the_next_as_it_is() {
        let doings = Arc::new(Doings::default());
        let (project, thread) = (ProjectId::new(), ThreadId::new());
        let mut before = Doer::new(doings.clone(), project, thread, TurnId::new());
        let next = TurnId::new();
        let after = Doer::new(doings.clone(), project, thread, next);
        // What the turn handed over still says changes nothing of the next.
        before
            .fold
            .hear(Step::Thought, banda_kernel::now_ms() - EVERY);
        before.say();
        let now = || doings.now(project).get(&thread).cloned();
        assert_eq!(now(), Some((next, after.fold.now().clone())));
        drop(before);
        assert_eq!(now(), Some((next, after.fold.now().clone())));
        drop(after);
        assert!(doings.now(project).is_empty());
    }
}
