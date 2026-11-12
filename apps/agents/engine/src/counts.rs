//! Who works and who waits for their Person on this machine, as the bar
//! counts them (ADR 0035): worked out here for a bar with no window, the
//! macOS menu bar and Omarchy's shell plugin, which read it from `banda
//! status` (ADR 0086, decision 4). It takes the window's rule as it is, a
//! Thread's mark (`markOf` in the agents Pane), where it stands (`standOf`
//! in the window's `status.ts`, which counts one that woke from Later by
//! itself) and the bar's tally, which leaves out what is put away, asleep
//! or archived (`tally` in the sidebar). `apps/agents/counted.json` holds
//! the cases both are to give: this module's tests read it, and so does
//! the window's (`counted.test.ts` in the agents Pane).
//! Pure: the caller brings the lists and the time.

use crate::model::{ListedThread, ThreadId, TurnState};
use crate::rules::later::{asleep, woke_by_itself};
use banda_kernel::ProjectId;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a Thread counts as: at work, or waiting for its Person, and for
/// what. The words are the Mark's, but `working`, as the bar counts its
/// `running`, and `woke`, which has no Mark of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum CountedAs {
    /// A turn runs.
    Working,
    /// A Question waits for its answer.
    Asking,
    /// Its latest turn failed, or Banda stopped while it ran, and its
    /// Person has not seen it.
    Failed,
    /// Its latest turn ended well, and its Person has not seen it.
    Done,
    /// It woke from Later by itself, its Person has not seen it wake, and
    /// nothing else calls them: it only waits.
    Woke,
}

impl CountedAs {
    /// Whether it waits for its Person: all but work.
    pub fn waits(self) -> bool {
        self != CountedAs::Working
    }
}

/// What `thread` counts as at `now`, or nothing: it rests, or its Person
/// put it away, asleep under a Later or archived, which the bar leaves out.
/// What it asks, its work and its latest turn come before a wake, as the
/// window's `standOf` has them.
pub fn counted(thread: &ListedThread, now: i64) -> Option<CountedAs> {
    let sleeps = (thread.later.as_ref()).is_some_and(|later| asleep(later, now));
    if sleeps || thread.is_archived() {
        return None;
    }
    if !thread.asking.is_empty() {
        return Some(CountedAs::Asking);
    }
    // A sub-agent at work after its turn ended keeps the Thread at work
    // (ADR 0103, decision 19).
    if thread.works() {
        return Some(CountedAs::Working);
    }
    let woke = woke_at(thread, now).map(|_| CountedAs::Woke);
    let Some(latest) = thread.latest.as_ref() else {
        return woke;
    };
    if thread.seen == Some(latest.turn) {
        return woke;
    }
    match latest.state {
        TurnState::Done => Some(CountedAs::Done),
        TurnState::Failed | TurnState::Interrupted => Some(CountedAs::Failed),
        // Its Person stopped it: nothing to tell them of the turn.
        _ => woke,
    }
}

/// When `thread` woke from its Later by itself, at `now`, while its
/// Person has not seen it wake; none otherwise (`wokeAt` in the window).
fn woke_at(thread: &ListedThread, now: i64) -> Option<i64> {
    let later = thread.later.as_ref()?;
    if later.woke_seen.is_some() || !woke_by_itself(later, now) {
        return None;
    }
    later.woke.map_or(later.until, |woke| Some(woke.at))
}

/// One Thread the bar counts, as its panel lists it: a row opens it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct CountedThread {
    pub thread: ThreadId,
    /// Its title, "New Thread" while it has none, as the sidebar shows it.
    pub title: String,
    pub project: ProjectId,
    /// Its Project's name, as the sidebar shows it: "No Project" for one
    /// Thread's own (ADR 0046).
    pub project_name: String,
    pub state: CountedAs,
}

/// Who works and who waits on this machine: how many of each, and each
/// one. `working`, `waiting`, `asking` and `done` mean what the bar's
/// counts of those names do (ADR 0035; `Count` in the sidebar's
/// settings), so a reader takes the one `[bar] counts` names.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct AgentCounts {
    /// Threads at work.
    pub working: u32,
    /// Every Thread that waits for its Person: `asking`, `done`, and
    /// what woke from Later by itself, unseen.
    pub waiting: u32,
    /// Threads that ask their Person, or failed: they need an answer.
    pub asking: u32,
    /// Of `asking`, those that failed: the bar's count of them is red.
    pub failed: u32,
    /// Threads that finished, and their Person has not seen.
    pub done: u32,
    /// What waits, the one that waited longest first, as the Inbox's
    /// Your turn goes; then what works, by when it began, so rows do not
    /// move while Agents write (ADR 0098, decision 3).
    pub threads: Vec<CountedThread>,
}

/// One Project's Threads as `agents.threads` lists them, and the name its
/// rows show.
pub struct ProjectThreads<'a> {
    pub project: ProjectId,
    pub name: &'a str,
    pub threads: &'a [ListedThread],
}

impl AgentCounts {
    /// What `projects`' Threads count as at `now`.
    pub fn of<'a>(projects: impl IntoIterator<Item = ProjectThreads<'a>>, now: i64) -> AgentCounts {
        let mut rows = Vec::new();
        for ProjectThreads {
            project,
            name,
            threads,
        } in projects
        {
            for thread in threads {
                let Some(state) = counted(thread, now) else {
                    continue;
                };
                // One that woke changed as it woke, as the sidebar has it.
                let changed = thread.thread.updated_at;
                let since = match (state, &thread.latest) {
                    (CountedAs::Working, Some(latest)) => latest.began,
                    _ => woke_at(thread, now).map_or(changed, |woke| woke.max(changed)),
                };
                let title = match thread.thread.title.as_str() {
                    "" => "New Thread",
                    title => title,
                };
                let row = CountedThread {
                    thread: thread.thread.id,
                    title: title.to_owned(),
                    project,
                    project_name: name.to_owned(),
                    state,
                };
                rows.push((state.waits(), since, row));
            }
        }
        // Waiting before working; each the earliest first.
        rows.sort_by(|a, b| {
            (b.0.cmp(&a.0))
                .then(a.1.cmp(&b.1))
                .then(a.2.thread.cmp(&b.2.thread))
        });
        let mut counts = AgentCounts::default();
        for (_, _, row) in rows {
            let one = |state| u32::from(row.state == state);
            counts.working += one(CountedAs::Working);
            counts.waiting += u32::from(row.state.waits());
            counts.asking += one(CountedAs::Asking) + one(CountedAs::Failed);
            counts.failed += one(CountedAs::Failed);
            counts.done += one(CountedAs::Done);
            counts.threads.push(row);
        }
        counts
    }
}

/// When the first of `threads` asleep at `now` wakes by its time: the
/// counts may change then with no fact to say so.
pub fn wakes_next<'a>(
    threads: impl IntoIterator<Item = &'a ListedThread>,
    now: i64,
) -> Option<i64> {
    (threads.into_iter())
        .filter_map(|thread| thread.later.as_ref())
        .filter(|later| asleep(later, now))
        .filter_map(|later| later.until)
        .min()
}

/// The facts after which a Thread may count as something else, or its row
/// say something else: a follower reads its Project's list again on them.
pub const KINDS: [&str; 20] = [
    "thread.started",
    "message.posted",
    "turn.started",
    "turn.ended",
    "thread.rewound",
    "thread.deleted",
    "thread.renamed",
    "question.asked",
    "question.answered",
    "question.closed",
    "thread.later",
    "thread.woke",
    "thread.woke_seen",
    "thread.seen",
    "thread.unseen",
    "thread.archived",
    "thread.unarchived",
    "marks.moved",
    "thread.left",
    "thread.arrived",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        Archived, Fact, Later, LatestTurn, ThreadSummary, TurnId, Wake, Woke, WokeSeen,
    };
    use banda_kernel::AgentId;
    use serde_json::json;

    /// `apps/agents/counted.json`: what each Thread counts as, which the
    /// window's rule gives too.
    #[derive(Deserialize)]
    struct Cases {
        now: i64,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        case: String,
        thread: ListedThread,
        counted: Option<CountedAs>,
    }

    #[test]
    fn each_thread_counts_as_the_shared_cases_say() {
        let Cases { now, cases } =
            serde_json::from_str(include_str!("../../counted.json")).unwrap();
        assert!(cases.len() >= 10, "the cases are there");
        for Case {
            case,
            thread,
            counted: expected,
        } in cases
        {
            assert_eq!(counted(&thread, now), expected, "{case}");
        }
    }

    fn thread(title: &str, updated_at: i64) -> ListedThread {
        ListedThread {
            thread: ThreadSummary {
                id: ThreadId::new(),
                harness: "fake".into(),
                title: title.into(),
                updated_at,
                was: None,
            },
            agent: AgentId::new(),
            parent: None,
            latest: None,
            asking: Vec::new(),
            message: None,
            later: None,
            seen: None,
            archived: None,
            now: Default::default(),
            changed_lines: None,
            subagents: None,
            crew: None,
        }
    }

    fn turn(thread: ListedThread, state: TurnState, began: i64) -> ListedThread {
        let latest = LatestTurn {
            turn: TurnId::new(),
            state,
            began,
            reason: None,
            note: None,
            failure: None,
        };
        ListedThread {
            latest: Some(latest),
            ..thread
        }
    }

    #[test]
    fn what_waits_comes_first_the_longest_waiting_first_then_what_works_by_when_it_began() {
        let project = ProjectId::new();
        let scratch = ProjectId::new();
        let threads = [
            turn(thread("Port the menu", 50), TurnState::Running, 40),
            turn(thread("Fix the bar", 30), TurnState::Done, 10),
            turn(thread("", 20), TurnState::Failed, 10),
            turn(thread("Stopped", 10), TurnState::Stopped, 5),
            thread("Never ran", 5),
            turn(thread("Earlier work", 60), TurnState::Running, 5),
            // Archived, with nothing new since.
            ListedThread {
                archived: Some(Archived { at: 100 }),
                ..turn(thread("Archived", 90), TurnState::Done, 80)
            },
        ];
        let (here, alone) = threads.split_at(5);
        let counts = AgentCounts::of(
            [
                ProjectThreads {
                    project,
                    name: "banda",
                    threads: here,
                },
                ProjectThreads {
                    project: scratch,
                    name: "No Project",
                    threads: alone,
                },
            ],
            1_000,
        );
        let rows: Vec<_> = (counts.threads.iter())
            .map(|row| (row.title.as_str(), row.project_name.as_str(), row.state))
            .collect();
        assert_eq!(
            rows,
            [
                ("New Thread", "banda", CountedAs::Failed),
                ("Fix the bar", "banda", CountedAs::Done),
                ("Earlier work", "No Project", CountedAs::Working),
                ("Port the menu", "banda", CountedAs::Working),
            ]
        );
        assert_eq!(
            (counts.working, counts.waiting),
            (2, 2),
            "who works, who waits"
        );
        assert_eq!(
            (counts.asking, counts.failed, counts.done),
            (1, 1, 1),
            "a failed one asks its Person too, as the bar's count of that name"
        );
        assert_eq!(counts.threads[0].project, project);
        assert_eq!(counts.threads[2].project, scratch);
        assert_eq!(AgentCounts::of([], 0), AgentCounts::default());
    }

    #[test]
    fn the_counts_name_their_fields_in_plain_words() {
        let thread = ThreadId::new();
        let project = ProjectId::new();
        let counts = AgentCounts {
            working: 0,
            waiting: 1,
            asking: 1,
            failed: 0,
            done: 0,
            threads: vec![CountedThread {
                thread,
                title: "Fix the bar".into(),
                project,
                project_name: "banda".into(),
                state: CountedAs::Asking,
            }],
        };
        assert_eq!(
            json!(counts),
            json!({
                "working": 0, "waiting": 1, "asking": 1, "failed": 0, "done": 0,
                "threads": [{
                    "thread": thread, "title": "Fix the bar", "project": project,
                    "project_name": "banda", "state": "asking",
                }],
            })
        );
    }

    #[test]
    fn a_thread_that_woke_by_itself_unseen_only_waits_from_when_it_woke() {
        let later = |until, woke, woke_seen| Later {
            at: 0,
            by: banda_kernel::Participant::Agent(AgentId::new()),
            until: Some(until),
            someday: false,
            woke,
            resume: None,
            woke_seen,
        };
        let put_off = |thread, later| ListedThread {
            later: Some(later),
            ..thread
        };
        let stopped = turn(thread("Woke", 100), TurnState::Stopped, 50);
        let woke = put_off(stopped, later(900, None, None));
        let seen = put_off(thread("Seen", 100), later(900, None, Some(WokeSeen::Seen)));
        let by_hand = Woke {
            at: 300,
            by: Wake::Woken,
        };
        let woken = put_off(thread("Woken", 100), later(2_000, Some(by_hand), None));
        let sleeps = put_off(thread("Sleeps", 100), later(2_000, None, None));
        let done = turn(thread("Done", 500), TurnState::Done, 400);
        assert_eq!(counted(&woke, 1_000), Some(CountedAs::Woke));
        assert_eq!(counted(&woke, 899), None, "asleep still");
        assert_eq!(counted(&seen, 1_000), None, "its Person saw it wake");
        assert_eq!(counted(&woken, 1_000), None, "its Person woke it");
        assert_eq!(counted(&sleeps, 1_000), None);
        assert_eq!(
            counted(&sleeps, 2_000),
            Some(CountedAs::Woke),
            "its time came"
        );
        let running = turn(woke.clone(), TurnState::Running, 950);
        assert_eq!(counted(&running, 1_000), Some(CountedAs::Working));

        let threads = [woke, seen, woken, sleeps, done];
        let projects = [ProjectThreads {
            project: ProjectId::new(),
            name: "banda",
            threads: &threads,
        }];
        let counts = AgentCounts::of(projects, 1_000);
        let rows: Vec<_> = (counts.threads.iter())
            .map(|row| (row.title.as_str(), row.state))
            .collect();
        assert_eq!(
            rows,
            [("Done", CountedAs::Done), ("Woke", CountedAs::Woke)],
            "it waited from 900, when it woke, not from 100"
        );
        let AgentCounts {
            working,
            waiting,
            asking,
            failed,
            done,
            ..
        } = counts;
        assert_eq!(
            [working, waiting, asking, failed, done],
            [0, 2, 0, 0, 1],
            "in waiting alone"
        );
        assert_eq!(json!(CountedAs::Woke), json!("woke"));
    }

    #[test]
    fn a_later_wakes_the_counts_by_its_time_alone() {
        let later = |until: Option<i64>| Later {
            at: 0,
            by: banda_kernel::Participant::Agent(AgentId::new()),
            until,
            someday: until.is_none(),
            woke: None,
            resume: None,
            woke_seen: None,
        };
        let put_off = |until| ListedThread {
            later: Some(later(until)),
            ..thread("Later", 0)
        };
        let threads = [put_off(Some(2_000)), put_off(Some(1_500)), put_off(None)];
        assert_eq!(wakes_next(&threads, 1_000), Some(1_500));
        assert_eq!(wakes_next(&threads, 1_600), Some(2_000));
        assert_eq!(wakes_next(&threads, 2_000), None, "all awake by then");
    }

    #[test]
    fn the_facts_a_follower_reads_again_on_are_the_modules_own() {
        for kind in KINDS {
            let said = serde_json::from_value::<Fact>(json!({ "kind": kind, "payload": {} }));
            let words = said
                .err()
                .map(|error| error.to_string())
                .unwrap_or_default();
            assert!(!words.contains("unknown variant"), "{kind}: {words}");
        }
        let unknown = serde_json::from_value::<Fact>(json!({ "kind": "no.such", "payload": {} }));
        assert!(unknown.unwrap_err().to_string().contains("unknown variant"));
        // A reply that grows changes no count, and is read again on none.
        assert!(!KINDS.contains(&"reply.grew"));
    }
}
