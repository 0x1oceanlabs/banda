//! Which file each worker at work in a Project reads or writes now, from
//! its tool calls as they start (ADR 0073, decision 9, as ADR 0103
//! amends it): one per worker, the turn and each sub-agent, so Files
//! pulses each one's row in its tree and can follow it. The Harness names
//! the files a tool call works on (ACP's locations), with a line where it
//! has one; a diff names the file it changes. Only memory holds it, as it
//! holds the turns: a turn's file goes as the turn ends, a sub-agent's as
//! it ends, and a restart forgets all.

use crate::model::{SubagentId, ThreadId, ToolContent, ToolKind};
use banda_kernel::{ProjectId, Stream};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, watch};
use ts_rs::TS;

/// A file a tool call names, as its Harness names it, and the line in it,
/// from 1.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    pub path: String,
    pub line: Option<u32>,
}

/// How a tool call works on a file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "agents/")]
pub enum TouchKind {
    Read,
    Write,
}

/// The file a worker of a Thread works on now: its turn, or one of its
/// sub-agents.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Touched {
    pub thread: ThreadId,
    /// The sub-agent that works on it, when it is not the turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub sub: Option<SubagentId>,
    /// The file, whole, as the Harness names it.
    pub path: String,
    /// The line the tool call names in it, from 1.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<u32>,
    pub kind: TouchKind,
    /// When its tool call started, in milliseconds since the epoch.
    #[ts(type = "number")]
    pub at: i64,
}

/// What `agents.touching` says: the file each Thread at work in the
/// Project works on now, one a worker of it.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct Touching {
    pub touched: Vec<Touched>,
}

/// The file the first diff of `content` changes.
pub fn diffed<'a>(content: impl IntoIterator<Item = &'a ToolContent>) -> Option<&'a str> {
    content.into_iter().find_map(|shown| match shown {
        ToolContent::Diff { path, .. } => Some(path.as_str()),
        _ => None,
    })
}

/// What a tool call of `kind` that names `places` and shows a diff of
/// `diff` works on: the first file it names, else the file its diff
/// changes. It writes when it edits, deletes or moves, or shows a diff; it
/// reads when it reads. A search, a command or a fetch names folders and
/// pages as often as files, so it touches none.
pub fn touched(
    thread: ThreadId,
    kind: ToolKind,
    places: &[Place],
    diff: Option<&str>,
    at: i64,
) -> Option<Touched> {
    let writes = matches!(kind, ToolKind::Edit | ToolKind::Delete | ToolKind::Move);
    let kind = if writes || diff.is_some() {
        TouchKind::Write
    } else if kind == ToolKind::Read {
        TouchKind::Read
    } else {
        return None;
    };
    let place = places
        .iter()
        .find(|place| !place.path.is_empty())
        .cloned()
        .or_else(|| {
            diff.map(|path| Place {
                path: path.to_owned(),
                line: None,
            })
        })?;
    Some(Touched {
        thread,
        sub: None,
        path: place.path,
        // ACP's lines start at 1; a 0 names none.
        line: place.line.filter(|line| *line > 0),
        kind,
        at,
    })
}

/// What memory holds of each Project's turns at work, made at first
/// need, and who hears it: what they touch here, and what they do
/// (`doing.rs`).
pub struct ByProject<T>(Mutex<HashMap<ProjectId, watch::Sender<T>>>);

impl<T> Default for ByProject<T> {
    fn default() -> ByProject<T> {
        ByProject(Mutex::default())
    }
}

impl<T: Default + Send + Sync + 'static> ByProject<T> {
    /// What `project`'s turns hold, made at first need.
    pub fn of(&self, project: ProjectId) -> watch::Sender<T> {
        let mut projects = self.0.lock().unwrap();
        let now = projects.entry(project);
        now.or_insert_with(|| watch::channel(T::default()).0)
            .clone()
    }

    /// What `piece` makes of what `project`'s turns hold now, then again
    /// each time it changes, until the one hearing lets go; nothing when
    /// it makes none. One slow to hear skips to what is so when it hears
    /// again.
    pub fn hear(
        &self,
        project: ProjectId,
        mut piece: impl FnMut(&T) -> Option<Value> + Send + 'static,
    ) -> Stream {
        let mut heard = self.of(project).subscribe();
        let (say, stream) = mpsc::channel(1);
        tokio::spawn(async move {
            loop {
                let said = piece(&heard.borrow_and_update());
                if let Some(said) = said
                    && say.send(said).await.is_err()
                {
                    return;
                }
                tokio::select! {
                    changed = heard.changed() => if changed.is_err() { return },
                    () = say.closed() => return,
                }
            }
        });
        stream
    }
}

/// What every Project's workers work on now, and who hears it.
#[derive(Default)]
pub struct Touches {
    projects: ByProject<Vec<Touched>>,
}

impl Touches {
    /// The worker `touched.sub` of `touched.thread`, or its turn, works on
    /// its file now.
    pub fn touch(&self, project: ProjectId, touched: Touched) {
        self.projects.of(project).send_if_modified(|now| {
            now.retain(|one| (one.thread, one.sub) != (touched.thread, touched.sub));
            now.push(touched);
            true
        });
    }

    /// The Thread's worker `sub`, or its turn, ended: it works on no file.
    /// The Thread's other workers go on with theirs.
    pub fn end(&self, project: ProjectId, thread: ThreadId, sub: Option<SubagentId>) {
        self.projects.of(project).send_if_modified(|now| {
            let was = now.len();
            now.retain(|one| (one.thread, one.sub) != (thread, sub));
            now.len() != was
        });
    }

    /// What `project`'s turns work on now, then again each time it
    /// changes, until the one hearing lets go. One slow to hear skips to
    /// what is so when it hears again.
    pub fn hear(&self, project: ProjectId) -> Stream {
        self.projects.hear(project, |touched| {
            let touched = touched.clone();
            serde_json::to_value(Touching { touched }).ok()
        })
    }
}

/// What one worker's tool calls work on, a turn's or a sub-agent's, told
/// to [`Touches`] as each starts; let go as the worker ends, it works on
/// nothing.
pub struct Toucher {
    touches: Arc<Touches>,
    project: ProjectId,
    thread: ThreadId,
    sub: Option<SubagentId>,
}

impl Toucher {
    /// A turn's.
    pub fn new(touches: Arc<Touches>, project: ProjectId, thread: ThreadId) -> Toucher {
        Toucher {
            touches,
            project,
            thread,
            sub: None,
        }
    }

    /// Sub-agent `sub`'s, while it is at work.
    pub fn lane(
        touches: Arc<Touches>,
        project: ProjectId,
        thread: ThreadId,
        sub: SubagentId,
    ) -> Toucher {
        Toucher {
            touches,
            project,
            thread,
            sub: Some(sub),
        }
    }

    /// A tool call of `kind` started, or changed, naming `places` and
    /// showing a diff of `diff`.
    pub fn tool(&self, kind: ToolKind, places: &[Place], diff: Option<&str>) {
        let at = banda_kernel::now_ms();
        if let Some(touched) = touched(self.thread, kind, places, diff, at) {
            let sub = self.sub;
            self.touches.touch(self.project, Touched { sub, ..touched });
        }
    }
}

/// Its worker ended: its own file goes, and the others' stay.
impl Drop for Toucher {
    fn drop(&mut self) {
        self.touches.end(self.project, self.thread, self.sub);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn place(path: &str, line: Option<u32>) -> Place {
        Place {
            path: path.to_owned(),
            line,
        }
    }

    fn diff(path: &str) -> ToolContent {
        ToolContent::Diff {
            path: path.to_owned(),
            old: None,
            new: String::new(),
        }
    }

    #[test]
    fn the_diff_named_is_the_first_a_tool_call_shows() {
        let text = ToolContent::Text {
            text: "a".to_owned(),
        };
        assert_eq!(
            diffed(&[text.clone(), diff("/w/a"), diff("/w/b")]),
            Some("/w/a")
        );
        assert_eq!(diffed(&[text]), None);
    }

    #[test]
    fn a_tool_call_touches_the_first_file_it_names_reading_or_writing_by_its_kind() {
        let thread = ThreadId::new();
        let read = touched(
            thread,
            ToolKind::Read,
            &[place("/w/a.ts", Some(12)), place("/w/b.ts", None)],
            None,
            7,
        );
        assert_eq!(
            read,
            Some(Touched {
                thread,
                sub: None,
                path: "/w/a.ts".to_owned(),
                line: Some(12),
                kind: TouchKind::Read,
                at: 7,
            })
        );
        for kind in [ToolKind::Edit, ToolKind::Delete, ToolKind::Move] {
            let wrote = touched(thread, kind, &[place("/w/a.ts", None)], None, 7);
            assert_eq!(wrote.map(|one| one.kind), Some(TouchKind::Write));
        }
        // A 0 names no line.
        let at_zero = touched(
            thread,
            ToolKind::Read,
            &[place("/w/a.ts", Some(0))],
            None,
            7,
        );
        assert_eq!(at_zero.and_then(|one| one.line), None);
    }

    #[test]
    fn a_diff_is_a_write_of_its_file_where_no_place_is_named() {
        let thread = ThreadId::new();
        let wrote = touched(thread, ToolKind::Other, &[], Some("/w/notes.md"), 7).unwrap();
        assert_eq!(
            (wrote.path.as_str(), wrote.kind),
            ("/w/notes.md", TouchKind::Write)
        );
        // Its places come first.
        let named = touched(
            thread,
            ToolKind::Edit,
            &[place("/w/a.ts", Some(3))],
            Some("/w/b.ts"),
            7,
        )
        .unwrap();
        assert_eq!((named.path.as_str(), named.line), ("/w/a.ts", Some(3)));
    }

    #[test]
    fn a_search_a_command_or_a_call_that_names_nothing_touches_nothing() {
        let thread = ThreadId::new();
        for kind in [
            ToolKind::Search,
            ToolKind::Execute,
            ToolKind::Fetch,
            ToolKind::Think,
            ToolKind::Other,
        ] {
            assert_eq!(touched(thread, kind, &[place("/w", None)], None, 7), None);
        }
        assert_eq!(touched(thread, ToolKind::Read, &[], None, 7), None);
        assert_eq!(
            touched(thread, ToolKind::Read, &[place("", None)], None, 7),
            None
        );
    }

    async fn next(stream: &mut Stream) -> Value {
        tokio::time::timeout(std::time::Duration::from_secs(5), stream.recv())
            .await
            .expect("a piece in time")
            .expect("the stream goes on")
    }

    #[tokio::test]
    async fn the_stream_says_each_threads_file_now_and_again_as_it_changes_and_its_turn_ends() {
        let touches = Arc::new(Touches::default());
        let project = ProjectId::new();
        let (one, two) = (ThreadId::new(), ThreadId::new());
        let first = Toucher::new(touches.clone(), project, one);
        first.tool(ToolKind::Read, &[place("/w/a.ts", Some(4))], None);

        // A window that comes now hears what is so.
        let mut heard = touches.hear(project);
        let piece = next(&mut heard).await;
        assert_eq!(piece["touched"][0]["path"], json!("/w/a.ts"));
        assert_eq!(piece["touched"][0]["line"], json!(4));
        assert_eq!(piece["touched"][0]["kind"], json!("read"));

        // Each Thread has its one file: the last its turn named.
        let second = Toucher::new(touches.clone(), project, two);
        second.tool(ToolKind::Edit, &[place("/w/b.ts", None)], None);
        let piece = next(&mut heard).await;
        assert_eq!(piece["touched"].as_array().unwrap().len(), 2);
        first.tool(ToolKind::Edit, &[], Some("/w/c.ts"));
        let piece = next(&mut heard).await;
        let paths: Vec<&str> = piece["touched"]
            .as_array()
            .unwrap()
            .iter()
            .map(|one| one["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, ["/w/b.ts", "/w/c.ts"]);
        assert!(piece["touched"][1].get("line").is_none());

        // A call that names no file leaves it as it was; a turn let go
        // works on nothing.
        first.tool(ToolKind::Execute, &[], None);
        drop(first);
        let piece = next(&mut heard).await;
        assert_eq!(piece["touched"].as_array().unwrap().len(), 1);
        assert_eq!(piece["touched"][0]["path"], json!("/w/b.ts"));

        // Another Project hears none of it.
        let mut elsewhere = touches.hear(ProjectId::new());
        assert_eq!(next(&mut elsewhere).await, json!({ "touched": [] }));
    }

    #[tokio::test]
    async fn a_sub_agents_touch_ends_with_it_and_the_turns_with_the_turn() {
        let touches = Arc::new(Touches::default());
        let (project, thread) = (ProjectId::new(), ThreadId::new());
        let (one, two) = (SubagentId::new(), SubagentId::new());
        let turn = Toucher::new(touches.clone(), project, thread);
        let first = Toucher::lane(touches.clone(), project, thread, one);
        let second = Toucher::lane(touches.clone(), project, thread, two);
        turn.tool(ToolKind::Edit, &[place("/w/turn.ts", None)], None);
        first.tool(ToolKind::Read, &[place("/w/one.ts", None)], None);
        second.tool(ToolKind::Read, &[place("/w/two.ts", None)], None);
        let mut heard = touches.hear(project);
        let paths = |piece: &Value| -> Vec<(String, Option<String>)> {
            (piece["touched"].as_array().unwrap().iter())
                .map(|one| {
                    let sub = one.get("sub").and_then(Value::as_str);
                    (
                        one["path"].as_str().unwrap().to_owned(),
                        sub.map(str::to_owned),
                    )
                })
                .collect()
        };
        // Each worker of the one Thread has its own file.
        let (one, two) = (Some(one.to_string()), Some(two.to_string()));
        let piece = next(&mut heard).await;
        assert_eq!(
            paths(&piece),
            [
                ("/w/turn.ts".to_owned(), None),
                ("/w/one.ts".to_owned(), one),
                ("/w/two.ts".to_owned(), two.clone()),
            ]
        );
        // A sub-agent's next call moves its file only.
        first.tool(ToolKind::Edit, &[place("/w/one-b.ts", None)], None);
        let piece = next(&mut heard).await;
        assert_eq!(paths(&piece).len(), 3);
        // A sub-agent that ends takes its file away, and the turn's stays.
        drop(first);
        let piece = next(&mut heard).await;
        assert_eq!(
            paths(&piece),
            [
                ("/w/turn.ts".to_owned(), None),
                ("/w/two.ts".to_owned(), two.clone())
            ]
        );
        // The turn's end clears only the turn's.
        drop(turn);
        let piece = next(&mut heard).await;
        assert_eq!(paths(&piece), [("/w/two.ts".to_owned(), two)]);
        drop(second);
        assert_eq!(next(&mut heard).await, json!({ "touched": [] }));
    }
}
