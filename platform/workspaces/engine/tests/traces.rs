//! The golden traces each client's copy of the arrangement replays
//! (`client/web/src/tiling/parity.test.ts`; ADR 0088, decision 11). Each
//! scenario holds rules of the arrangement: its commands run through
//! `commands::apply`, on the model functions the module's handlers run,
//! and it is written to
//! `platform/workspaces/traces/` as JSON, with each step's answer or
//! refusal and the arrangement after it.
//!
//! A change to the model changes them. The test then writes them anew and
//! fails once, as `cargo test` writes the TypeScript types: review what
//! changed, make the client's copy do the same, and run it again.
//!
//! ```sh
//! cargo test -p banda-workspaces --test traces
//! ```
//!
//! Nothing in them is random, so a trace changes only when what the model
//! does changes: step `n` of scenario `s` runs under the command ID
//! `{s:08x}-0000-4000-8000-{n:012x}`, and its start is made under step 0's.
//! Params, answers and each Pane's args are written with their keys in
//! order: serde_json keeps keys in the order given only when another crate
//! of the build asks it to, as one does under `cargo test --workspace`.

use banda_kernel::{Code, Refusal};
use banda_workspaces::commands::{self, METHODS};
use banda_workspaces::model::{self, Arrangement, Seed};
use banda_workspaces::placing::{Facts, Flow};
use banda_workspaces::tiling::{Opens, Rule};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;

const WORK: &str = "a0000000-0000-4000-8000-000000000001";
const HOME: &str = "a0000000-0000-4000-8000-000000000002";
const THIRD: &str = "a0000000-0000-4000-8000-000000000003";
const FOURTH: &str = "a0000000-0000-4000-8000-000000000004";
const FIFTH: &str = "a0000000-0000-4000-8000-000000000005";
const AGENT: &str = "b0000000-0000-4000-8000-000000000001";
/// A kind that stands on its Project's workspace, where the facts say so.
const THREAD: &str = "t.t";
/// An ID the workspaces hold nowhere.
const NOWHERE: &str = "e0000000-0000-4000-8000-000000000001";

/// The ID of what a window made, as one it kept before (`take`).
fn kept(n: u32) -> String {
    format!("d0000000-0000-4000-8000-{n:012x}")
}

/// The command ID of step `n` of scenario `s`.
fn command_id(s: u32, n: usize) -> String {
    format!("{s:08x}-0000-4000-8000-{n:012x}")
}

#[derive(Serialize)]
struct Trace {
    /// The rules it holds.
    about: &'static str,
    start: Arrangement,
    steps: Vec<Step>,
}

#[derive(Serialize)]
struct Step {
    /// As a client sends it: `workspaces.open`.
    method: String,
    /// The command's ID, whose `Seed` names what it makes.
    seed: String,
    params: Value,
    /// What the engine places a Pane by, when it is not the Flow `free`
    /// with no kind known (`placing::Facts`).
    #[serde(skip_serializing_if = "Option::is_none")]
    facts: Option<Facts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    answer: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    refused: Option<Code>,
    /// The arrangement after it: the one before, when it was refused.
    after: Arrangement,
}

/// A scenario, as its steps run.
struct Tracing {
    number: u32,
    slug: &'static str,
    trace: Trace,
    list: Arrangement,
    /// The facts its next steps run by.
    facts: Facts,
}

impl Tracing {
    fn new(number: u32, slug: &'static str, about: &'static str) -> Tracing {
        let start = model::start_from(&Seed::of(&command_id(number, 0)));
        Tracing {
            number,
            slug,
            facts: Facts::default(),
            list: start.clone(),
            trace: Trace {
                about,
                start: in_order(start),
                steps: Vec::new(),
            },
        }
    }

    /// The seed of step `n`, which names what it makes.
    fn seed(&self, n: usize) -> Seed {
        Seed::of(&command_id(self.number, n))
    }

    /// The seed of the step that runs next.
    fn next(&self) -> Seed {
        self.seed(self.trace.steps.len() + 1)
    }

    /// Runs a step that passes, and its answer.
    fn ok(&mut self, method: &str, params: Value) -> Value {
        let n = self.trace.steps.len() + 1;
        match self.run(method, params) {
            Ok(answer) => answer,
            Err(refusal) => panic!("{}, step {n}, {method}: {refusal}", self.slug),
        }
    }

    /// Runs a step that is refused with `code`.
    fn refused(&mut self, method: &str, params: Value, code: Code) {
        let n = self.trace.steps.len() + 1;
        match self.run(method, params) {
            Ok(_) => panic!("{}, step {n}, {method}: passed", self.slug),
            Err(refusal) => assert_eq!(refusal.code, code, "{}, step {n}: {refusal}", self.slug),
        }
    }

    /// Opens a Pane, and its ID.
    fn opened(&mut self, params: Value) -> String {
        let answer = self.ok("open", params);
        answer["pane"].as_str().unwrap().to_owned()
    }

    /// Runs a step on a copy, as a refused command may leave the
    /// arrangement half changed, and keeps the copy when it passes.
    fn run(&mut self, method: &str, mut params: Value) -> Result<Value, Refusal> {
        let seed = command_id(self.number, self.trace.steps.len() + 1);
        let mut list = self.list.clone();
        let facts = &self.facts;
        let applied = commands::apply(&mut list, method, params.clone(), facts, &Seed::of(&seed));
        if applied.is_ok() {
            self.list = list;
        }
        params.sort_all_objects();
        let mut answer = applied.as_ref().ok().cloned();
        answer.iter_mut().for_each(Value::sort_all_objects);
        self.trace.steps.push(Step {
            method: format!("workspaces.{method}"),
            seed,
            params,
            facts: (self.facts != Facts::default()).then(|| self.facts.clone()),
            answer,
            refused: applied.as_ref().err().map(|refusal| refusal.code),
            after: in_order(self.list.clone()),
        });
        applied
    }

    fn list(&self) -> &Arrangement {
        &self.list
    }

    /// The next steps run in `flow`, with a Thread's kind standing on its
    /// Project's workspace.
    fn in_the_flow(&mut self, flow: Flow) {
        self.facts.flow = flow;
        self.facts.home = BTreeSet::from([THREAD.to_owned()]);
    }

    /// The next steps run with this rule of `kind`, as `tiling.toml` says
    /// it: a new column's width, and where a Pane of it opens.
    fn ruled(&mut self, kind: &str, width: Option<&str>, opens: Option<Opens>) {
        let rule = Rule {
            width: width.map(str::to_owned),
            opens,
        };
        self.facts.rules.insert(kind.to_owned(), rule);
    }

    /// The next steps run with `kind` a list beside other Panes, and
    /// `narrowest` the narrowest of the Tiling's widths.
    fn lists(&mut self, kind: &str, narrowest: &str) {
        self.facts.narrow.insert(kind.to_owned());
        self.facts.narrowest = Some(narrowest.to_owned());
    }

    /// Each workspace's columns by their width, where one was given.
    fn widths(&self) -> Vec<Vec<Option<&str>>> {
        (self.list.iter())
            .map(|w| w.columns.iter().map(|c| c.width.as_deref()).collect())
            .collect()
    }

    /// The next steps run with a Thread's kind leading its Group.
    fn led_by_threads(&mut self) {
        self.facts.leads = BTreeSet::from([THREAD.to_owned()]);
    }

    fn workspace(&self, w: usize) -> String {
        self.list[w].id.to_string()
    }

    /// The empty workspace at the bottom.
    fn bottom(&self) -> String {
        self.workspace(self.list.len() - 1)
    }

    fn column(&self, w: usize, c: usize) -> String {
        self.list[w].columns[c].id.to_string()
    }

    fn pane(&self, w: usize, c: usize, p: usize) -> String {
        self.list[w].columns[c].panes[p].id.to_string()
    }

    /// Each workspace's columns, each column's Panes by their args' `n`.
    fn layout(&self) -> Vec<Vec<Vec<u64>>> {
        (self.list.iter())
            .map(|w| {
                (w.columns.iter())
                    .map(|c| {
                        (c.panes.iter())
                            .map(|p| p.shows.args["n"].as_u64().unwrap_or(0))
                            .collect()
                    })
                    .collect()
            })
            .collect()
    }

    /// Each workspace's columns by their Group, numbered as they first
    /// stand, from 1; 0 for none.
    fn grouping(&self) -> Vec<Vec<usize>> {
        let mut seen = Vec::new();
        (self.list.iter())
            .map(|w| {
                (w.columns.iter())
                    .map(|c| {
                        let Some(g) = c.group else { return 0 };
                        if !seen.contains(&g) {
                            seen.push(g);
                        }
                        1 + seen.iter().position(|&s| s == g).unwrap()
                    })
                    .collect()
            })
            .collect()
    }
}

/// `list`, each Pane's args with their keys in order.
fn in_order(mut list: Arrangement) -> Arrangement {
    for pane in (list.iter_mut())
        .flat_map(|w| &mut w.columns)
        .flat_map(|c| &mut c.panes)
    {
        pane.shows.args.sort_all_objects();
    }
    list
}

/// What a Pane shows, as `open`'s params: its args' `n`.
fn shows(project: &str, kind: &str, n: u32) -> Value {
    json!({ "project": project, "kind": kind, "args": { "n": n } })
}

/// `base`, with `more`'s fields too.
fn and(mut base: Value, more: Value) -> Value {
    let more = more.as_object().unwrap().clone();
    base.as_object_mut().unwrap().extend(more);
    base
}

/// A workspace with no column.
const EMPTY: Vec<Vec<u64>> = Vec::new();

fn the_bottom_workspace() -> Tracing {
    let mut t = Tracing::new(
        1,
        "the-bottom-workspace",
        "A Pane opens on the top workspace that shows its Project's Panes, else on the \
         empty one at the bottom, under which a new empty one comes. One shown already is \
         named, unless it opens again. A width is a share of the screen. An empty \
         workspace in the middle stays until the window tidies.",
    );
    let made = t.next();
    let one = t.opened(shows(WORK, "a.a", 1));
    assert_eq!(one, made.pane().to_string());
    assert_eq!(t.list()[0].columns[0].id, made.column());
    assert_eq!(t.list()[1].id, made.bottom());
    let named = t.ok("open", shows(WORK, "a.a", 1));
    assert_eq!(named, json!({ "pane": one, "new": false }));
    let two = t.opened(and(shows(WORK, "a.a", 1), json!({ "again": true })));
    t.ok("open", shows(HOME, "a.a", 2));
    t.ok(
        "open",
        and(shows(WORK, "a.a", 3), json!({ "width": "1/3" })),
    );
    t.ok(
        "open",
        and(shows(WORK, "a.a", 4), json!({ "width": " .5 " })),
    );
    t.ok(
        "open",
        and(shows(WORK, "a.a", 5), json!({ "width": "1e-1" })),
    );
    assert_eq!(
        t.layout(),
        [
            vec![vec![1], vec![1], vec![3], vec![4], vec![5]],
            vec![vec![2]],
            EMPTY
        ]
    );
    for bad in ["3/2", "1/2/3", "0x1", "0", "1/0", "-1/2", "inf", "", "half"] {
        let width = and(shows(WORK, "a.a", 6), json!({ "width": bad }));
        t.refused("open", width, Code::Invalid);
    }
    for bad in ["a", "a.", ".a"] {
        t.refused("open", shows(WORK, bad, 6), Code::Invalid);
    }
    let listed = json!({ "project": WORK, "kind": "a.a", "args": [1] });
    t.refused("open", listed, Code::Invalid);
    t.ok("close", json!({ "pane": two }));
    t.refused("close", json!({ "pane": two }), Code::NotFound);
    // Onto the empty workspace: a new one comes under it.
    let (column, bottom) = (t.column(0, 0), t.bottom());
    let down = t.next();
    let to_bottom = json!({ "column": column, "workspace": bottom, "index": 0 });
    t.ok("move_column", to_bottom);
    assert_eq!(t.bottom(), down.bottom().to_string());
    // Emptied in the middle, it stays until the window tidies.
    let home = t.pane(1, 0, 0);
    t.ok("close", json!({ "pane": home }));
    assert_eq!(t.layout()[1], EMPTY);
    let looked_at = t.workspace(1);
    t.ok("tidy", json!({ "keep": looked_at }));
    assert_eq!(t.list().len(), 4);
    t.ok("tidy", json!({}));
    assert_eq!(t.list().len(), 3);
    t.ok("tidy", json!({}));
    t
}

fn beside_and_instead() -> Tracing {
    let mut t = Tracing::new(
        2,
        "beside-and-instead",
        "A Pane opens beside another, at a column's place on a workspace, in a column's \
         stack, or instead of another, which leaves; past the last place, the last. One \
         shown already stays where it is.",
    );
    let one = t.opened(shows(WORK, "a.a", 1));
    let beside = |pane: &str, side: &str| json!({ "to": "beside", "pane": pane, "side": side });
    for (n, side) in [(2, "right"), (3, "left"), (4, "below"), (5, "above")] {
        t.ok(
            "open",
            and(
                shows(WORK, "a.a", n),
                json!({ "place": beside(&one, side) }),
            ),
        );
    }
    assert_eq!(t.layout()[0], [vec![3], vec![5, 1, 4], vec![2]]);
    let made = t.next();
    let six = t.opened(and(shows(WORK, "a.a", 6), json!({ "instead": one })));
    assert_eq!(six, made.pane().to_string());
    assert_eq!(t.layout()[0], [vec![3], vec![5, 6, 4], vec![2]]);
    let both = json!({ "place": beside(&six, "left"), "instead": six });
    t.refused("open", and(shows(WORK, "a.a", 7), both), Code::Invalid);
    let gone = json!({ "instead": NOWHERE });
    t.refused("open", and(shows(WORK, "a.a", 7), gone), Code::NotFound);
    // Shown already: named, and it stays.
    let named = json!({ "place": beside(&six, "left") });
    t.ok("open", and(shows(WORK, "a.a", 2), named));
    let here = t.workspace(0);
    let column = |index: u32| json!({ "to": "column", "workspace": here, "index": index });
    t.ok(
        "open",
        and(shows(WORK, "a.a", 7), json!({ "place": column(0) })),
    );
    t.ok(
        "open",
        and(shows(WORK, "a.a", 8), json!({ "place": column(9) })),
    );
    let lost = json!({ "to": "column", "workspace": NOWHERE, "index": 0 });
    t.refused(
        "open",
        and(shows(WORK, "a.a", 9), json!({ "place": lost })),
        Code::NotFound,
    );
    let middle = t.column(0, 2);
    let stack = |index: u32| json!({ "to": "stack", "column": middle, "index": index });
    t.ok(
        "open",
        and(shows(WORK, "a.a", 9), json!({ "place": stack(9) })),
    );
    t.ok(
        "open",
        and(shows(WORK, "a.a", 10), json!({ "place": stack(0) })),
    );
    let lost = json!({ "to": "stack", "column": NOWHERE, "index": 0 });
    t.refused(
        "open",
        and(shows(WORK, "a.a", 11), json!({ "place": lost })),
        Code::NotFound,
    );
    let lost = beside(NOWHERE, "right");
    t.refused(
        "open",
        and(shows(WORK, "a.a", 11), json!({ "place": lost })),
        Code::NotFound,
    );
    assert_eq!(
        t.layout()[0],
        [vec![7], vec![3], vec![10, 5, 6, 4, 9], vec![2], vec![8]]
    );
    // A width is a new column's: in a stack, it has none.
    let wide = json!({ "place": beside(&six, "right"), "width": "2/3" });
    t.ok("open", and(shows(WORK, "a.a", 11), wide));
    let under = json!({ "place": beside(&six, "below"), "width": "2/3" });
    t.ok("open", and(shows(WORK, "a.a", 12), under));
    t
}

fn moves() -> Tracing {
    let mut t = Tracing::new(
        3,
        "moves",
        "A Pane alone in its column moves with it, its ID and its width; one in a stack \
         leaves it for a new column, or changes places in it, counted as if it had left. \
         Dropped between workspaces, a Pane makes one there, never under the empty one. \
         A Pane's height is its column's, so it leaves it there.",
    );
    let one = t.opened(shows(WORK, "a.a", 1));
    let beside = |pane: &str, side: &str| json!({ "to": "beside", "pane": pane, "side": side });
    let two = t.opened(and(
        shows(WORK, "a.a", 2),
        json!({ "place": beside(&one, "right") }),
    ));
    let three = t.opened(and(
        shows(WORK, "a.a", 3),
        json!({ "place": beside(&two, "below") }),
    ));
    let first = t.column(0, 0);
    t.ok("size", json!({ "column": first, "width": "1/3" }));
    let to = |pane: &str, place: Value| json!({ "pane": pane, "place": place });
    // Alone: its column goes along, with its width.
    t.ok("move_pane", to(&one, beside(&three, "right")));
    assert_eq!(t.layout()[0], [vec![2, 3], vec![1]]);
    assert_eq!(t.column(0, 1), first);
    // In a stack: it leaves for a column of its own, which the command makes.
    let here = t.workspace(0);
    let out = t.next();
    let left = json!({ "to": "column", "workspace": here, "index": 0 });
    t.ok("move_pane", to(&three, left));
    assert_eq!(t.layout()[0], [vec![3], vec![2], vec![1]]);
    assert_eq!(t.column(0, 0), out.column().to_string());
    // Into a column's stack, then down it.
    let column = t.column(0, 1);
    let stack = |index: u32| json!({ "to": "stack", "column": column, "index": index });
    t.ok("move_pane", to(&one, stack(0)));
    t.ok("move_pane", to(&one, stack(1)));
    assert_eq!(t.layout()[0], [vec![3], vec![2, 1]]);
    // Alone, into its own column: it stays.
    let alone = t.column(0, 0);
    let own = json!({ "to": "stack", "column": alone, "index": 5 });
    t.ok("move_pane", to(&three, own.clone()));
    t.refused("move_pane", to(&one, beside(&one, "right")), Code::Invalid);
    t.refused("move_pane", to(NOWHERE, stack(0)), Code::NotFound);
    let lost = json!({ "to": "stack", "column": NOWHERE, "index": 0 });
    t.refused("move_pane", to(&two, lost), Code::NotFound);
    // Heights, kept in their column until the Pane leaves it.
    t.ok("height", json!({ "pane": two, "height": "1/3" }));
    t.ok("height", json!({ "pane": one, "height": "1/2" }));
    t.refused(
        "height",
        json!({ "pane": one, "height": "3/2" }),
        Code::Invalid,
    );
    t.refused(
        "height",
        json!({ "pane": NOWHERE, "height": "1/2" }),
        Code::NotFound,
    );
    let last = json!({ "to": "column", "workspace": here, "index": 9 });
    t.ok("move_pane", to(&two, last));
    assert_eq!(t.layout()[0], [vec![3], vec![1], vec![2]]);
    let ones = t.column(0, 1);
    t.ok("even", json!({ "column": ones }));
    t.refused("even", json!({ "column": NOWHERE }), Code::NotFound);
    // A Pane alone that moves into its own column leaves its height there.
    t.ok("height", json!({ "pane": three, "height": "1/2" }));
    t.ok("move_pane", to(&three, own));
    // Between workspaces: a new one there, which the command makes.
    let between = t.next();
    t.ok(
        "move_pane",
        to(&one, json!({ "to": "workspace", "index": 0 })),
    );
    assert_eq!(t.workspace(0), between.workspace().to_string());
    t.ok(
        "move_pane",
        to(&two, json!({ "to": "workspace", "index": 1 })),
    );
    t.ok(
        "move_pane",
        to(&three, json!({ "to": "workspace", "index": 9 })),
    );
    assert_eq!(
        t.layout(),
        [vec![vec![1]], vec![vec![2]], EMPTY, vec![vec![3]], EMPTY]
    );
    t
}

fn move_workspace() -> Tracing {
    let mut t = Tracing::new(
        4,
        "move-workspace",
        "A workspace moves whole, counted as if it had left its place; past the last, the \
         last above the empty one at the bottom, which stays there.",
    );
    t.ok("open", shows(WORK, "agents.thread", 1));
    let below = json!({ "place": { "to": "workspace", "index": 9 } });
    t.ok("open", and(shows(WORK, "a.a", 2), below.clone()));
    t.ok("open", and(shows(WORK, "a.a", 3), below));
    let third = t.workspace(2);
    t.ok("move_workspace", json!({ "workspace": third, "index": 0 }));
    assert_eq!(
        t.layout(),
        [vec![vec![3]], vec![vec![1]], vec![vec![2]], EMPTY]
    );
    t.ok("move_workspace", json!({ "workspace": third, "index": 9 }));
    assert_eq!(
        t.layout(),
        [vec![vec![1]], vec![vec![2]], vec![vec![3]], EMPTY]
    );
    let middle = t.workspace(1);
    t.ok("move_workspace", json!({ "workspace": middle, "index": 1 }));
    let bottom = t.bottom();
    t.refused(
        "move_workspace",
        json!({ "workspace": bottom, "index": 0 }),
        Code::Invalid,
    );
    t.refused(
        "move_workspace",
        json!({ "workspace": NOWHERE, "index": 0 }),
        Code::NotFound,
    );
    t
}

fn project_row() -> Tracing {
    let mut t = Tracing::new(
        5,
        "project-row",
        "A Project's Threads open last on its own workspace, in a row: the one it owns, \
         even emptied while it has Threads; else the empty one at the bottom, which it \
         owns then. A free workspace or another Project's is never its row. A Thread of \
         no Project opens on the top free workspace, else on the bottom one.",
    );
    let row = |project: &str| json!({ "place": { "to": "project", "project": project } });
    let free = json!({ "place": { "to": "free" } });
    t.ok("open", and(shows(WORK, "agents.thread", 1), row(WORK)));
    t.ok("open", and(shows(HOME, "agents.thread", 2), row(HOME)));
    t.ok("open", and(shows(WORK, "agents.thread", 3), row(WORK)));
    assert_eq!(t.layout(), [vec![vec![1], vec![3]], vec![vec![2]], EMPTY]);
    // A free workspace that shows its Panes is not its row.
    t.ok("open", shows(THIRD, "a.a", 7));
    t.ok("open", and(shows(THIRD, "agents.thread", 8), row(THIRD)));
    assert_eq!(t.layout()[2], [vec![7]]);
    assert_eq!(t.layout()[3], [vec![8]]);
    // Emptied, it stays while its Project has Threads, and is its row.
    let home = t.pane(1, 0, 0);
    t.ok("close", json!({ "pane": home }));
    t.ok("tidy", json!({ "projects": [HOME] }));
    assert_eq!(t.layout()[1], EMPTY);
    t.ok("open", and(shows(HOME, "agents.thread", 4), row(HOME)));
    assert_eq!(t.layout()[1], [vec![4]]);
    // With none, it goes.
    let four = t.pane(1, 0, 0);
    t.ok("close", json!({ "pane": four }));
    t.ok("tidy", json!({}));
    assert_eq!(t.layout().len(), 4);
    // Another Project's workspace is never its row, though it shows its Panes.
    let work = t.workspace(0);
    let on_work = json!({ "place": { "to": "column", "workspace": work, "index": 9 } });
    t.ok("open", and(shows(FOURTH, "a.a", 9), on_work));
    t.ok("open", and(shows(FOURTH, "agents.thread", 10), row(FOURTH)));
    assert_eq!(t.layout()[3], [vec![10]]);
    // A Thread of no Project: the top free workspace.
    t.ok("open", and(shows(FIFTH, "agents.thread", 11), free));
    assert_eq!(t.layout()[1], [vec![7], vec![11]]);
    t
}

fn own_group() -> Tracing {
    let mut t = Tracing::new(
        13,
        "own-group",
        "A Project's own Panes open last into its own Group, first on its workspace: the \
         Group is made at the start when there is none, and goes with its last Pane.",
    );
    let row = |project: &str| json!({ "place": { "to": "project", "project": project } });
    let own = |project: &str| json!({ "place": { "to": "own", "project": project } });
    t.ok("open", and(shows(WORK, "agents.thread", 1), row(WORK)));
    t.ok("open", and(shows(WORK, "terminal.terminal", 2), own(WORK)));
    t.ok("open", and(shows(WORK, "terminal.terminal", 3), own(WORK)));
    assert_eq!(t.layout()[0], [vec![2], vec![3], vec![1]]);
    assert_eq!(t.grouping()[0][..2], [1, 1]);
    // A Project with no workspace: the bottom one, its own Group on it.
    t.ok("open", and(shows(HOME, "files.files", 4), own(HOME)));
    assert_eq!(t.layout()[1], [vec![4]]);
    let four = t.pane(1, 0, 0);
    t.ok("close", json!({ "pane": four }));
    t.ok("open", and(shows(HOME, "files.files", 5), own(HOME)));
    assert_eq!(t.layout()[1], [vec![5]]);
    t
}

fn arranged() -> Tracing {
    let mut t = Tracing::new(
        14,
        "arranged",
        "Arranging by Project puts each Group, and each column in none, on its Project's \
         workspace, and one of no Project on a free one: one with no lead and no Pane an \
         Agent opened into the own Group, first, a Group just after it in the order they \
         stood, and one led by a Pane of a kind that `leads` (a Thread) last, as its \
         lead's Project says, still filling the screen, as one an Agent opened; one \
         already there stays, but for the Person's own column in none, which joins the \
         own Group, and with `only` only that Project's move, and none already there.",
    );
    t.ok("open", shows(WORK, "terminal.terminal", 1));
    let first = t.list()[0].id.to_string();
    let last = json!({ "place": { "to": "column", "workspace": first, "index": 99 } });
    for (project, n) in [(HOME, 2), (THIRD, 3), (WORK, 4), (FOURTH, 5)] {
        t.ok(
            "open",
            and(shows(project, "terminal.terminal", n), last.clone()),
        );
    }
    let projects = [WORK, HOME, FOURTH];
    // As a window sends them: the kinds that lead a Group, a Thread's.
    let leads = ["agents.thread"];
    t.ok(
        "arrange",
        json!({ "projects": projects, "leads": leads, "only": HOME }),
    );
    assert_eq!(t.layout()[0], [vec![1], vec![3], vec![4], vec![5]]);
    assert_eq!(t.layout()[1], [vec![2]]);
    // Two new workspaces in one go, each its own, with its own Group.
    t.ok("arrange", json!({ "projects": projects, "leads": leads }));
    assert_eq!(t.layout()[0], [vec![3]]);
    assert_eq!(t.layout()[2], [vec![1], vec![4]]);
    assert_eq!(t.layout()[3], [vec![5]]);
    assert_eq!(
        t.grouping(),
        [vec![0], vec![1], vec![2, 2], vec![3], vec![]]
    );
    let ids: BTreeSet<_> = t.list().iter().map(|w| w.id).collect();
    assert_eq!(ids.len(), t.list().len());
    // On the free one, WORK's Agent's Group, a Pane of HOME first in it,
    // filling the screen; and a terminal of WORK in none.
    let grouped = and(last.clone(), json!({ "grouped": true }));
    let thread = t.opened(and(shows(WORK, "agents.thread", 6), grouped));
    let left = json!({ "place": { "to": "beside", "pane": thread, "side": "left" } });
    t.ok("open", and(shows(HOME, "browser.browser", 7), left));
    let (browser, agent) = (t.column(0, 1), t.column(0, 2));
    t.ok("regroup", json!({ "column": browser, "toward": "right" }));
    t.ok("fill", json!({ "column": agent, "fill": true }));
    t.ok(
        "open",
        and(shows(WORK, "terminal.terminal", 8), last.clone()),
    );
    t.ok(
        "arrange",
        json!({ "projects": projects, "leads": leads, "only": HOME }),
    );
    assert_eq!(t.layout()[0], [vec![3], vec![7], vec![6], vec![8]]);
    t.ok("arrange", json!({ "projects": projects, "leads": leads }));
    assert_eq!(t.layout()[2], [vec![1], vec![4], vec![8], vec![7], vec![6]]);
    assert_eq!(t.grouping()[2], [2, 2, 2, 3, 3]);
    assert_eq!(t.list()[2].filled, t.list()[2].columns[3].group);
    // Again, nothing moves.
    let before = t.list().clone();
    t.ok("arrange", json!({ "projects": projects, "leads": leads }));
    assert_eq!(*t.list(), before);
    // Later, on the free one: two Groups the Person made of WORK's
    // terminals and one in none; and, as a window kept them, a Group an
    // Agent left with a Diff it opened, and a browser it opened in none.
    for n in [9, 10, 11, 12] {
        t.ok(
            "open",
            and(shows(WORK, "terminal.terminal", n), last.clone()),
        );
    }
    let (nine, ten, eleven) = (t.column(0, 1), t.column(0, 2), t.column(0, 3));
    t.ok("group", json!({ "column": nine }));
    t.ok("regroup", json!({ "column": ten, "toward": "left" }));
    t.ok("group", json!({ "column": eleven }));
    let agents = |id: u32, kind: &str, n: u32| json!({ "id": kept(id), "project": WORK, "kind": kind, "args": { "n": n }, "by": AGENT });
    let window = json!([{
        "id": kept(1),
        "columns": [
            { "id": kept(2), "panes": [agents(3, "git.diff", 13)], "group": kept(4) },
            { "id": kept(5), "panes": [agents(6, "browser.browser", 14)] },
        ],
    }]);
    t.ok("take", json!({ "workspaces": window }));
    t.ok("arrange", json!({ "projects": projects, "leads": leads }));
    // The one in none joins the own Group, the Person's Groups stand just
    // after it as they stood, and what the Agent opened goes last.
    let work: Vec<_> = [1, 4, 8, 12, 9, 10, 11, 7, 6, 13, 14]
        .map(|n| vec![n])
        .into();
    assert_eq!(t.layout()[3], work);
    assert_eq!(t.grouping()[3], [2, 2, 2, 2, 3, 3, 4, 5, 5, 6, 0]);
    // A terminal of WORK put in none on WORK's own workspace joins the
    // own Group too; the browser the Agent opened there stays in none.
    let own_row = json!({ "place": {
        "to": "column", "workspace": t.workspace(3), "index": 99,
    } });
    t.ok("open", and(shows(WORK, "terminal.terminal", 15), own_row));
    // Not when only WORK's are sent home, as a Project just made one is.
    let before = t.list().clone();
    t.ok(
        "arrange",
        json!({ "projects": projects, "leads": leads, "only": WORK }),
    );
    assert_eq!(*t.list(), before);
    t.ok("arrange", json!({ "projects": projects, "leads": leads }));
    let work: Vec<_> = [1, 4, 8, 12, 15, 9, 10, 11, 7, 6, 13, 14]
        .map(|n| vec![n])
        .into();
    assert_eq!(t.layout()[3], work);
    assert_eq!(t.grouping()[3], [2, 2, 2, 2, 2, 3, 3, 4, 5, 5, 6, 0]);
    // Again, nothing moves.
    let before = t.list().clone();
    t.ok("arrange", json!({ "projects": projects, "leads": leads }));
    assert_eq!(*t.list(), before);
    t
}

fn thread_groups() -> Tracing {
    let mut t = Tracing::new(
        6,
        "thread-groups",
        "A Thread opens as a Group, and what it opens goes into its Group as a Deck right \
         of it; one shown already stays. A Thread opened again is only named.",
    );
    let thread = json!({ "project": WORK, "kind": "agents.thread", "args": { "n": 1 } });
    let made = t.next();
    let first = t.opened(and(thread.clone(), json!({ "grouped": true })));
    assert_eq!(t.list()[0].columns[0].group, Some(made.group()));
    let lone = t.opened(shows(WORK, "a.a", 2));
    let group = json!({ "place": { "to": "group", "pane": first } });
    t.ok("open", and(shows(WORK, "git.diff", 3), group.clone()));
    assert_eq!(t.layout()[0], [vec![1], vec![3], vec![2]]);
    assert_eq!(t.grouping()[0], [1, 1, 0]);
    t.ok(
        "open",
        and(shows(WORK, "browser.browser", 4), group.clone()),
    );
    let again = t.ok("open", and(shows(WORK, "git.diff", 3), group.clone()));
    assert_eq!(again["new"], false);
    let into = json!({ "pane": lone, "place": { "to": "group", "pane": first } });
    t.ok("move_pane", into);
    assert_eq!(t.layout()[0], [vec![1], vec![3, 4, 2]]);
    let deck = t.column(0, 1);
    t.ok("regroup", json!({ "column": deck, "toward": "right" }));
    assert_eq!(t.grouping()[0], [1, 0]);
    t.ok("open", and(thread, json!({ "grouped": true })));
    // The Deck right of it is no longer its: a new one.
    t.ok("open", and(shows(WORK, "git.diff", 5), group));
    assert_eq!(t.grouping()[0], [1, 1, 0]);
    // Into a Pane's in no Group: its column starts one.
    let alone = t.pane(0, 2, 0);
    let made = t.next();
    let into = json!({ "place": { "to": "group", "pane": alone } });
    t.ok("open", and(shows(WORK, "a.a", 6), into));
    assert_eq!(t.list()[0].columns[2].group, Some(made.group()));
    t.refused(
        "open",
        and(
            shows(WORK, "a.a", 7),
            json!({ "place": { "to": "group", "pane": NOWHERE } }),
        ),
        Code::NotFound,
    );
    t
}

fn group_keys() -> Tracing {
    let mut t = Tracing::new(
        7,
        "group-keys",
        "A Group starts of a column alone, columns join it and leave it either way, and it \
         moves whole: past the column after it, and never into another Group.",
    );
    for n in 1..=4 {
        t.ok("open", shows(WORK, "a.a", n));
    }
    let c: Vec<String> = (0..4).map(|i| t.column(0, i)).collect();
    let made = t.next();
    t.ok("group", json!({ "column": c[1] }));
    assert_eq!(t.list()[0].columns[1].group, Some(made.group()));
    t.ok("group", json!({ "column": c[1] }));
    t.refused("group", json!({ "column": NOWHERE }), Code::NotFound);
    let regroup = |column: &str, toward: &str| json!({ "column": column, "toward": toward });
    t.ok("regroup", regroup(&c[2], "left"));
    // No Group beside it that way.
    t.refused("regroup", regroup(&c[0], "left"), Code::Invalid);
    t.ok("regroup", regroup(&c[0], "right"));
    assert_eq!(t.grouping()[0], [1, 1, 1, 0]);
    t.refused("regroup", regroup(&c[3], "right"), Code::Invalid);
    t.refused("regroup", regroup(NOWHERE, "left"), Code::NotFound);
    // From the middle, it leaves past its Group's columns that way.
    t.ok("regroup", regroup(&c[1], "right"));
    assert_eq!(t.layout()[0], [[1], [3], [2], [4]]);
    assert_eq!(t.grouping()[0], [1, 1, 0, 0]);
    t.ok("regroup", regroup(&c[0], "left"));
    t.ok("regroup", regroup(&c[2], "left"));
    assert_eq!(t.grouping()[0], [0, 0, 0, 0]);
    // Two Groups in a row of five.
    t.ok("open", shows(WORK, "a.a", 5));
    let c: Vec<String> = (0..5).map(|i| t.column(0, i)).collect();
    t.ok("group", json!({ "column": c[0] }));
    t.ok("regroup", regroup(&c[1], "left"));
    t.ok("group", json!({ "column": c[3] }));
    t.ok("regroup", regroup(&c[4], "left"));
    assert_eq!(t.layout()[0], [[1], [3], [2], [4], [5]]);
    let here = t.workspace(0);
    let to = |column: &str, workspace: &str, index: u32| json!({ "column": column, "workspace": workspace, "index": index });
    t.ok("move_group", to(&c[1], &here, 1));
    assert_eq!(t.layout()[0], [[2], [1], [3], [4], [5]]);
    // Into the other Group's middle is past it.
    t.ok("move_group", to(&c[0], &here, 2));
    assert_eq!(t.layout()[0], [[2], [4], [5], [1], [3]]);
    assert_eq!(t.grouping()[0], [0, 1, 1, 2, 2]);
    // A column in none moves alone.
    t.ok("move_group", to(&c[2], &here, 9));
    assert_eq!(t.layout()[0], [[4], [5], [1], [3], [2]]);
    // To another workspace, all of it.
    let bottom = t.bottom();
    t.ok("move_group", to(&c[4], &bottom, 0));
    assert_eq!(
        t.layout(),
        [
            vec![vec![1], vec![3], vec![2]],
            vec![vec![4], vec![5]],
            EMPTY
        ]
    );
    t.refused("move_group", to(&c[4], NOWHERE, 0), Code::NotFound);
    t.refused("move_group", to(NOWHERE, &here, 0), Code::NotFound);
    t
}

fn fill_size_maximize_display() -> Tracing {
    let mut t = Tracing::new(
        8,
        "fill-size-maximize-display",
        "A Group fills the screen until a width is given, and goes with its Group; a \
         column takes the whole screen, keeping its width for after, and shows its Panes \
         one above another or as a Deck.",
    );
    for n in 1..=3 {
        t.ok("open", shows(WORK, "a.a", n));
    }
    let c: Vec<String> = (0..3).map(|i| t.column(0, i)).collect();
    t.refused(
        "fill",
        json!({ "column": c[0], "fill": true }),
        Code::Invalid,
    );
    t.refused(
        "fill",
        json!({ "column": NOWHERE, "fill": true }),
        Code::NotFound,
    );
    t.ok("group", json!({ "column": c[0] }));
    t.ok("regroup", json!({ "column": c[1], "toward": "left" }));
    t.ok("fill", json!({ "column": c[1], "fill": true }));
    t.ok("fill", json!({ "column": c[1], "fill": false }));
    t.ok("fill", json!({ "column": c[0], "fill": true }));
    // It goes with its Group.
    let below = t.bottom();
    t.ok(
        "move_group",
        json!({ "column": c[0], "workspace": below, "index": 0 }),
    );
    assert_eq!(
        (t.list()[0].filled, t.list()[1].filled.is_some()),
        (None, true)
    );
    // A width given ends it.
    t.ok("size", json!({ "column": c[0], "width": "1/3" }));
    assert_eq!(t.list()[1].filled, None);
    t.ok("maximize", json!({ "column": c[2], "full": true }));
    t.ok("maximize", json!({ "column": c[2], "full": false }));
    t.ok("maximize", json!({ "column": c[2], "full": true }));
    t.refused(
        "maximize",
        json!({ "column": NOWHERE, "full": true }),
        Code::NotFound,
    );
    t.ok("size", json!({ "column": c[2], "width": "2/3" }));
    t.ok("maximize", json!({ "column": c[2], "full": true }));
    // A width given, or none, ends the whole screen.
    t.ok("size", json!({ "column": c[2] }));
    t.refused(
        "size",
        json!({ "column": c[2], "width": "2" }),
        Code::Invalid,
    );
    t.refused(
        "size",
        json!({ "column": NOWHERE, "width": "1/2" }),
        Code::NotFound,
    );
    t.ok("display", json!({ "column": c[2], "display": "deck" }));
    t.ok("display", json!({ "column": c[2], "display": "stack" }));
    t.ok("display", json!({ "column": c[2] }));
    // A Deck's old name, as a kept arrangement may still say.
    t.ok("display", json!({ "column": c[2], "display": "tabs" }));
    t.refused("display", json!({ "column": NOWHERE }), Code::NotFound);
    t
}

fn group_edges() -> Tracing {
    let mut t = Tracing::new(
        9,
        "group-edges",
        "At a Group's end, the mouse says whether a column goes inside it or out; between \
         two of its columns, it is in the Group whatever it says. A Pane taken out of a \
         Group's column beside it stays in it, and a column alone of its Group keeps it \
         wherever it goes; one moved away from the rest leaves it.",
    );
    for n in 1..=4 {
        t.ok("open", shows(WORK, "a.a", n));
    }
    let c: Vec<String> = (0..4).map(|i| t.column(0, i)).collect();
    t.ok("group", json!({ "column": c[0] }));
    t.ok("regroup", json!({ "column": c[1], "toward": "left" }));
    let (first, last, lone) = (t.pane(0, 0, 0), t.pane(0, 1, 0), t.pane(0, 3, 0));
    let right = json!({ "to": "beside", "pane": last, "side": "right" });
    let mouse = |grouped: Option<bool>| match grouped {
        None => json!({ "pane": lone, "place": right }),
        Some(inside) => json!({ "pane": lone, "place": right, "grouped": inside }),
    };
    t.ok("move_pane", mouse(None));
    assert_eq!(t.grouping()[0], [1, 1, 0, 0]);
    t.ok("move_pane", mouse(Some(true)));
    assert_eq!(t.grouping()[0], [1, 1, 1, 0]);
    t.ok("move_pane", mouse(Some(false)));
    assert_eq!(t.grouping()[0], [1, 1, 0, 0]);
    let between = json!({ "to": "beside", "pane": first, "side": "right" });
    t.ok(
        "move_pane",
        json!({ "pane": lone, "place": between, "grouped": false }),
    );
    assert_eq!(t.grouping()[0], [1, 1, 1, 0]);
    // Beside a Group's end, a Thread that opens as a Group starts its own.
    let end = json!({ "to": "beside", "pane": last, "side": "right" });
    let thread = and(
        shows(WORK, "agents.thread", 5),
        json!({ "place": end, "grouped": true }),
    );
    t.ok("open", thread);
    assert_eq!(t.grouping()[0], [1, 1, 1, 2, 0]);
    // Taken out of a Group's column, beside it, it stays in the Group.
    let below = json!({ "to": "beside", "pane": first, "side": "below" });
    let joined = t.opened(and(shows(HOME, "a.a", 6), json!({ "place": below })));
    let here = t.workspace(0);
    let beside = json!({ "to": "column", "workspace": here, "index": 1 });
    t.ok("move_pane", json!({ "pane": joined, "place": beside }));
    assert_eq!(t.grouping()[0], [1, 1, 1, 1, 2, 0]);
    // Moved past its Group's edge, a column leaves it.
    let edge = t.column(0, 0);
    let past = json!({ "column": edge, "workspace": here, "index": 5 });
    t.ok("move_column", past);
    assert_eq!(t.grouping()[0], [1, 1, 1, 2, 0, 0]);
    // Alone of its Group, it keeps it wherever it goes.
    let alone = t.column(0, 3);
    let bottom = t.bottom();
    t.ok(
        "move_column",
        json!({ "column": alone, "workspace": bottom, "index": 0 }),
    );
    assert_eq!(t.grouping()[1], [2]);
    t.refused(
        "move_column",
        json!({ "column": alone, "workspace": NOWHERE, "index": 0 }),
        Code::NotFound,
    );
    t.refused(
        "move_column",
        json!({ "column": NOWHERE, "workspace": here, "index": 0 }),
        Code::NotFound,
    );
    t
}

fn take_over() -> Tracing {
    let mut t = Tracing::new(
        10,
        "take-over",
        "A window's arrangement goes over the engine's with the IDs it holds: a Pane shown \
         twice is kept the first time, and of the empty workspaces only the last stays. \
         Each workspace, column and Pane needs an ID of its own, and a width or a height \
         is a share.",
    );
    t.ok("open", shows(WORK, "a.a", 2));
    t.ok("open", shows(WORK, "a.a", 3));
    let pane = |id: u32, n: u32| json!({ "id": kept(id), "project": WORK, "kind": "a.a", "args": { "n": n } });
    let column = |id: u32, panes: Value| json!({ "id": kept(id), "panes": panes, "full": false });
    let workspace = |id: u32, columns: Value| json!({ "id": kept(id), "columns": columns });
    let group = kept(90);
    let window = json!([
        {
            "id": kept(1),
            "columns": [{
                "id": kept(2),
                "panes": [
                    and(pane(3, 1), json!({ "by": AGENT })),
                    and(pane(4, 2), json!({ "height": "1/3" })),
                ],
                "width": "1/2",
                "full": true,
                "display": "deck",
                "group": group,
            }, {
                "id": kept(5),
                "panes": [pane(6, 4)],
                "group": group,
            }],
            "filled": group,
            "project": WORK,
        },
        workspace(7, json!([column(8, json!([pane(9, 1)]))])),
        workspace(10, json!([])),
        workspace(11, json!([column(12, json!([pane(13, 5)]))])),
    ]);
    t.ok("take", json!({ "workspaces": window }));
    assert_eq!(
        t.layout(),
        [
            vec![vec![1, 2], vec![4]],
            vec![vec![5]],
            vec![vec![3]],
            EMPTY
        ]
    );
    let one = |columns: Value| json!({ "workspaces": [{ "id": kept(20), "columns": columns }] });
    let twice = json!([
        column(21, json!([pane(22, 6)])),
        column(21, json!([pane(23, 7)]))
    ]);
    t.refused("take", one(twice), Code::Invalid);
    let held = json!([column(2, json!([pane(24, 6)]))]);
    t.refused("take", one(held), Code::Invalid);
    let as_pane = json!([column(25, json!([pane(25, 6)]))]);
    t.refused("take", one(as_pane), Code::Invalid);
    let wide = json!([and(
        column(26, json!([pane(27, 6)])),
        json!({ "width": "3/2" })
    )]);
    t.refused("take", one(wide), Code::Invalid);
    let high = json!([column(
        28,
        json!([and(pane(29, 6), json!({ "height": "0" }))])
    )]);
    t.refused("take", one(high), Code::Invalid);
    let kindless = json!([column(
        30,
        json!([and(pane(31, 6), json!({ "kind": "a" }))])
    )]);
    t.refused("take", one(kindless), Code::Invalid);
    let listed = json!([column(
        32,
        json!([and(pane(33, 6), json!({ "args": [6] }))])
    )]);
    t.refused("take", one(listed), Code::Invalid);
    // A column that does not say `full` takes none, and a Deck's old name reads.
    let plain = json!([{ "id": kept(34), "panes": [pane(35, 6)], "display": "tabs" }]);
    t.ok("take", one(plain));
    t
}

fn ran_before() -> Tracing {
    let mut t = Tracing::new(
        11,
        "ran-before",
        "A command whose IDs the workspaces hold ran before, past the receipt that would \
         have answered it: it is refused, whatever it is, and changes nothing. Its params \
         are read first.",
    );
    let pane = |id: String, n: u32| json!({ "id": id, "project": WORK, "kind": "a.a", "args": { "n": n } });
    let holding = |w: String, c: String, group: Option<String>, p: String, n: u32| {
        let mut column = json!({ "id": c, "panes": [pane(p, n)], "full": false });
        if let Some(group) = group {
            column["group"] = json!(group);
        }
        json!({ "workspaces": [{ "id": w, "columns": [column] }] })
    };
    let open_at = t.seed(2);
    t.ok(
        "take",
        holding(kept(1), kept(2), None, open_at.pane().to_string(), 1),
    );
    t.refused("open", shows(WORK, "a.a", 2), Code::Conflict);
    let group_at = t.seed(4);
    t.ok(
        "take",
        holding(
            kept(3),
            kept(4),
            Some(group_at.group().to_string()),
            kept(5),
            3,
        ),
    );
    let column = t.column(1, 0);
    t.refused("group", json!({ "column": column }), Code::Conflict);
    let tidy_at = t.seed(6);
    t.ok(
        "take",
        holding(tidy_at.workspace().to_string(), kept(6), None, kept(7), 4),
    );
    t.refused("tidy", json!({}), Code::Conflict);
    let read_at = t.seed(8);
    t.ok(
        "take",
        holding(kept(8), read_at.column().to_string(), None, kept(9), 5),
    );
    t.refused(
        "open",
        json!({ "project": WORK, "kind": "a.a" }),
        Code::Invalid,
    );
    t.refused(
        "move_column",
        json!({ "column": column, "workspace": kept(8), "index": -1 }),
        Code::Invalid,
    );
    t.refused("noop", json!({}), Code::Invalid);
    // Another command's are free.
    t.ok("open", shows(WORK, "a.a", 2));
    t
}

fn update() -> Tracing {
    let mut t = Tracing::new(
        12,
        "update",
        "A Pane keeps new args where it is, an object; two Panes may show the same then, \
         and one opened names the first. Args are the same with their keys in any order, \
         and a null in them is part of them.",
    );
    let one = t.opened(shows(WORK, "a.a", 1));
    t.ok("update", json!({ "pane": one, "args": { "n": 7 } }));
    t.refused(
        "update",
        json!({ "pane": one, "args": null }),
        Code::Invalid,
    );
    t.refused("update", json!({ "pane": one, "args": [7] }), Code::Invalid);
    t.refused(
        "update",
        json!({ "pane": NOWHERE, "args": { "n": 7 } }),
        Code::NotFound,
    );
    let two = t.opened(shows(WORK, "a.a", 2));
    t.ok("update", json!({ "pane": two, "args": { "n": 7 } }));
    let named = t.ok("open", shows(WORK, "a.a", 7));
    assert_eq!(named, json!({ "pane": one, "new": false }));
    t.ok("close", json!({ "pane": one }));
    let named = t.ok("open", shows(WORK, "a.a", 7));
    assert_eq!(named, json!({ "pane": two, "new": false }));
    let deep = json!({ "n": 8, "deep": { "b": [1, { "z": null }], "a": "x" } });
    t.ok("update", json!({ "pane": two, "args": deep }));
    let same = json!({ "project": WORK, "kind": "a.a", "args": deep });
    let named = t.ok("open", same);
    assert_eq!(named["new"], false);
    for other in [json!({}), json!({ "z": 1 })] {
        let args = json!({ "n": 8, "deep": { "b": [1, other], "a": "x" } });
        let named = t.ok(
            "open",
            json!({ "project": WORK, "kind": "a.a", "args": args }),
        );
        assert_eq!(named["new"], true);
    }
    t
}

/// A Thread, as the window opens one: a Group of its own.
fn thread(project: &str, n: u32) -> Value {
    and(shows(project, THREAD, n), json!({ "grouped": true }))
}

/// `open`'s params from a click in `pane` (ADR 0134, decision 1).
fn clicked(pane: &str) -> Value {
    json!({ "from": pane, "via": "click" })
}

/// `open`'s params, of no Project, as the engine says of its own Projects
/// and the window of another machine's.
fn of_none(params: Value) -> Value {
    and(params, json!({ "scratch": true }))
}

fn placed_free() -> Tracing {
    let mut t = Tracing::new(
        15,
        "placed-free",
        "In the Flow free, a Pane with no place opens right of the Pane it is opened \
         from, a Thread and what is opened for an Agent too; with none in front, last \
         on the workspace on screen; with neither, where a Pane with no place goes. \
         One moved to another Project takes the place of the one it was.",
    );
    t.in_the_flow(Flow::Free);
    let one = t.opened(shows(WORK, "a.a", 1));
    let from = |pane: &str| json!({ "from": pane });
    t.ok("open", and(shows(WORK, "a.a", 2), from(&one)));
    t.ok("open", and(thread(HOME, 3), from(&one)));
    assert_eq!(t.layout(), [vec![vec![1], vec![3], vec![2]], EMPTY]);
    assert_eq!(t.grouping()[0], [0, 1, 0]);
    // With no Pane in front, on the workspace on screen.
    let bottom = t.bottom();
    let four = t.opened(and(shows(THIRD, "a.a", 4), json!({ "on": bottom })));
    // One gone, a Pane or a workspace, counts as none.
    let gone = json!({ "from": NOWHERE, "on": NOWHERE });
    t.ok("open", and(shows(THIRD, "a.a", 5), gone));
    assert_eq!(t.layout()[1], [vec![4], vec![5]]);
    // For an Agent whose Thread no workspace shows, as the Person's.
    let agents = and(from(&four), json!({ "agents": true }));
    t.ok("open", and(shows(WORK, "a.a", 6), agents));
    t.ok(
        "open",
        and(shows(WORK, "a.a", 7), json!({ "agents": true })),
    );
    assert_eq!(
        t.layout(),
        [
            vec![vec![1], vec![3], vec![2], vec![7]],
            vec![vec![4], vec![6], vec![5]],
            EMPTY
        ]
    );
    let moved = json!({ "instead": one, "moved": true });
    t.ok("open", and(shows(HOME, "a.a", 8), moved));
    assert_eq!(t.layout()[0], [vec![8], vec![3], vec![2], vec![7]]);
    t
}

fn placed_row() -> Tracing {
    let mut t = Tracing::new(
        16,
        "placed-row",
        "In the row, a Pane with no place opens by where it is opened from: from the \
         Project's own Group, last into it; by a click in a Group, into that \
         Group; on a free workspace, right of the Pane in front; any other, and with \
         none in front, into its Project's own Group. A Thread goes last on its \
         Project's workspace, and so does what is opened for an Agent. A Pane of no \
         Project goes right of the Pane in front, a Thread of none on the top free \
         workspace.",
    );
    t.in_the_flow(Flow::Row);
    let from = |pane: &str| json!({ "from": pane });
    // With none in front, the Project's own Group, which makes its
    // workspace; from it, last into it.
    let one = t.opened(shows(WORK, "a.a", 1));
    t.ok("open", and(shows(WORK, "a.a", 2), from(&one)));
    // A Thread, last on its Project's workspace; by a click in it, into
    // its Group.
    let three = t.opened(and(thread(WORK, 3), from(&one)));
    t.ok("open", and(shows(WORK, "a.a", 4), clicked(&three)));
    assert_eq!(
        t.layout(),
        [vec![vec![1], vec![2], vec![3], vec![4]], EMPTY]
    );
    assert_eq!(t.grouping()[0], [1, 1, 2, 2]);
    assert_eq!(t.list()[0].own, t.list()[0].columns[0].group);
    // Another Project's, from a Group, goes home.
    let five = t.opened(and(shows(HOME, "a.a", 5), from(&three)));
    assert_eq!(t.list()[1].project.unwrap().to_string(), HOME);
    // Of no Project: right of the Pane in front; a Thread, on the top free
    // workspace; by a click in its Group, into it; with none in front, on
    // the workspace on screen.
    let none = |n| of_none(shows(FIFTH, "a.a", n));
    t.ok("open", and(none(6), from(&five)));
    let seven = t.opened(and(of_none(thread(FIFTH, 7)), from(&five)));
    t.ok("open", and(none(8), clicked(&seven)));
    let free = t.workspace(2);
    let nine = t.opened(and(none(9), json!({ "on": free })));
    // On a free workspace, a Project's stays, right of the Pane in front.
    t.ok("open", and(shows(THIRD, "a.a", 10), from(&nine)));
    assert_eq!(
        t.layout(),
        [
            vec![vec![1], vec![2], vec![3], vec![4]],
            vec![vec![5], vec![6]],
            vec![vec![7], vec![8], vec![9], vec![10]],
            EMPTY
        ]
    );
    assert_eq!(t.grouping()[1..3], [vec![3, 0], vec![4, 4, 0, 0]]);
    assert_eq!(t.list()[2].project, None);
    // From a column in no Group on its Project's workspace, the own Group.
    let on_work = json!({ "place": { "to": "project", "project": WORK } });
    let loose = t.opened(and(shows(WORK, "a.a", 11), on_work));
    t.ok("open", and(shows(WORK, "a.a", 12), from(&loose)));
    // For an Agent whose Thread no workspace shows: last on its Project's
    // workspace, or, of no Project, on the top free one.
    let agents = and(from(&one), json!({ "agents": true }));
    t.ok("open", and(shows(WORK, "a.a", 13), agents));
    t.ok("open", and(none(14), json!({ "agents": true })));
    // A Pane in front that has gone counts as none.
    t.ok("open", and(shows(WORK, "a.a", 15), from(NOWHERE)));
    assert_eq!(
        t.layout()[0],
        [
            vec![1],
            vec![2],
            vec![12],
            vec![15],
            vec![3],
            vec![4],
            vec![11],
            vec![13]
        ]
    );
    assert_eq!(t.grouping()[0], [1, 1, 1, 1, 2, 2, 0, 0]);
    assert_eq!(t.layout()[2].last().unwrap(), &[14]);
    // Of no Project with nothing in front: where a Pane with no place goes.
    t.ok("open", none(16));
    assert_eq!(t.layout()[1], [vec![5], vec![6], vec![16]]);
    t
}

fn moved_away() -> Tracing {
    let mut t = Tracing::new(
        17,
        "moved-away",
        "In the row, a Pane opened instead of one that showed the same in another \
         Project, on a workspace that is not the new Project's, opens where the Flow \
         says, and the one it was leaves. On its own Project's workspace or a free \
         one it takes that Pane's place, and so does one not moved.",
    );
    t.in_the_flow(Flow::Row);
    let moved = |instead: &str| json!({ "instead": instead, "moved": true });
    let one = t.opened(thread(WORK, 1));
    // To another Project: home, and its workspace stays the first's.
    let made = t.next();
    let two = t.opened(and(thread(HOME, 2), moved(&one)));
    assert_eq!(two, made.pane().to_string());
    assert_eq!(t.layout(), [EMPTY, vec![vec![2]], EMPTY]);
    assert_eq!(t.grouping()[1], [1]);
    assert_eq!(t.list()[0].project.unwrap().to_string(), WORK);
    // Within its Project, and on a free workspace, where it stands.
    let three = t.opened(and(thread(HOME, 3), moved(&two)));
    let free = json!({ "place": { "to": "free" } });
    let four = t.opened(and(thread(THIRD, 4), free));
    t.ok("open", and(thread(FOURTH, 5), moved(&four)));
    assert_eq!(t.layout(), [EMPTY, vec![vec![3]], vec![vec![5]], EMPTY]);
    // Not moved, as a draft that became its Thread: where it stands.
    let six = t.opened(and(thread(WORK, 6), json!({ "instead": three })));
    assert_eq!(t.layout()[1], [vec![6]]);
    // Of no Project, and no Thread: right of the one it was, which leaves.
    t.ok("open", and(of_none(shows(FIFTH, "a.a", 7)), moved(&six)));
    assert_eq!(t.layout(), [EMPTY, vec![vec![7]], vec![vec![5]], EMPTY]);
    assert_eq!(t.grouping()[1], [0]);
    t.refused("open", and(thread(WORK, 8), moved(NOWHERE)), Code::NotFound);
    t
}

fn refused_moves() -> Tracing {
    let mut t = Tracing::new(
        18,
        "refused-moves",
        "In the row, nothing moves onto a workspace another Project owns: a Pane alone \
         as its own Project's, a column as its first Pane's, a Group as its lead's, an \
         Agent's Thread's, and a Pane brought to a place as one moved there. It goes \
         to its Project's workspace, a free one and a new one, and moves as it likes \
         on the workspace it stands on. A Pane opened at a place that is not brought \
         opens there. In the Flow free nothing is refused.",
    );
    t.in_the_flow(Flow::Row);
    t.led_by_threads();
    let last = |workspace: &str| json!({ "to": "column", "workspace": workspace, "index": 9 });
    let pane_to = |pane: &str, place: Value| json!({ "pane": pane, "place": place });
    let column_to = |column: &str, workspace: &str| json!({ "column": column, "workspace": workspace, "index": 0 });
    // Work's Thread with Home's Pane in its Group, Home's own Pane on
    // Home's workspace, and a Pane of Work on a free one.
    let thread = t.opened(thread(WORK, 1));
    let in_group = json!({ "place": { "to": "group", "pane": thread } });
    let guest = t.opened(and(shows(HOME, "a.a", 2), in_group));
    let theirs = t.opened(shows(HOME, "a.a", 3));
    let free = json!({ "place": { "to": "free" } });
    let loose = t.opened(and(shows(WORK, "a.a", 4), free));
    assert_eq!(
        t.layout(),
        [vec![vec![1], vec![2]], vec![vec![3]], vec![vec![4]], EMPTY]
    );
    let (works, homes, frees) = (t.workspace(0), t.workspace(1), t.workspace(2));
    assert_eq!(t.list()[1].project.unwrap().to_string(), HOME);

    // A Pane alone, by every place that lands on Home's workspace.
    let theirs_column = t.column(1, 0);
    for place in [
        last(&homes),
        json!({ "to": "stack", "column": theirs_column, "index": 0 }),
        json!({ "to": "beside", "pane": theirs, "side": "right" }),
        json!({ "to": "group", "pane": theirs }),
        json!({ "to": "project", "project": HOME }),
        json!({ "to": "own", "project": HOME }),
        // A Project with no workspace yet would own the empty one.
        json!({ "to": "project", "project": THIRD }),
    ] {
        t.refused("move_pane", pane_to(&loose, place), Code::Conflict);
    }
    // The Group whole is Work's, by whichever of its columns; its lead's
    // column alone too. Home's guest alone goes home.
    let (leads, guests) = (t.column(0, 0), t.column(0, 1));
    t.refused("move_group", column_to(&leads, &homes), Code::Conflict);
    t.refused("move_group", column_to(&guests, &homes), Code::Conflict);
    t.refused("move_column", column_to(&leads, &homes), Code::Conflict);
    // On the workspace it stands on, the guest moves as it likes.
    t.ok("move_column", column_to(&guests, &works));
    assert_eq!(t.layout()[0], [vec![2], vec![1]]);
    t.ok("move_column", column_to(&guests, &homes));
    assert_eq!(t.layout()[..2], [vec![vec![1]], vec![vec![2], vec![3]]]);
    assert_eq!(guest, t.pane(1, 0, 0));

    // Brought to a place, as "Open beside", a new Pane is refused as one
    // moved there; one only opened there opens.
    let there = json!({ "again": true, "place": last(&homes) });
    let brought = and(there.clone(), json!({ "brought": true }));
    t.refused(
        "open",
        and(shows(WORK, "a.a", 5), brought.clone()),
        Code::Conflict,
    );
    t.ok("open", and(shows(HOME, "a.a", 5), brought));
    let stray = t.opened(and(shows(WORK, "a.a", 6), there));
    assert_eq!(t.layout()[1], [vec![2], vec![3], vec![5], vec![6]]);

    // Where a Pane goes: on the workspace it stands on, to its Project's,
    // to a free one, and to a new one.
    let first = json!({ "to": "column", "workspace": homes, "index": 0 });
    t.ok("move_pane", pane_to(&stray, first));
    t.ok("move_pane", pane_to(&stray, last(&works)));
    t.ok("move_pane", pane_to(&stray, last(&frees)));
    t.ok("move_group", column_to(&leads, &frees));
    t.ok(
        "move_pane",
        pane_to(&loose, json!({ "to": "workspace", "index": 0 })),
    );
    assert_eq!(
        t.layout(),
        [
            vec![vec![4]],
            EMPTY,
            vec![vec![2], vec![3], vec![5]],
            vec![vec![1], vec![6]],
            EMPTY
        ]
    );
    // Emptied, Work's workspace is Work's still.
    t.refused("move_pane", pane_to(&guest, last(&works)), Code::Conflict);

    // In the Flow free, every workspace takes any Pane.
    t.in_the_flow(Flow::Free);
    t.ok("move_pane", pane_to(&loose, last(&homes)));
    t.ok("move_group", column_to(&leads, &homes));
    assert_eq!(t.layout()[2], [vec![1], vec![2], vec![3], vec![5], vec![4]]);
    t
}

fn rules() -> Tracing {
    let mut t = Tracing::new(
        19,
        "rules",
        "A rule of a kind of Pane, as tiling.toml says it, gives its new column a \
         width where the command names none, and says where a Pane of it opens when \
         no one named a place: right of the Pane in front, under it, into its Group, \
         or last on its Project's workspace, over what the kind says of itself. It \
         gives way with no Pane in front, and in the row from a workspace another \
         Project owns; a place named and what is opened for an Agent go as without \
         it. A list's new column, where no rule of its kind says a width, takes \
         the narrowest of the Tiling's widths, for an Agent too; under another \
         Pane it takes none.",
    );
    t.ruled("w.w", Some("1/3"), None);
    t.ruled("r.r", Some("2/3"), Some(Opens::Beside));
    t.ruled("b.b", None, Some(Opens::Below));
    t.ruled("g.g", None, Some(Opens::Group));
    t.ruled("p.p", None, Some(Opens::Project));
    // A Thread's kind that a rule opens beside, as any other Pane.
    t.ruled(THREAD, None, Some(Opens::Beside));
    let from = |pane: &str| json!({ "from": pane });

    // In the Flow free: a width where none is named, the one named else.
    t.in_the_flow(Flow::Free);
    let one = t.opened(shows(WORK, "w.w", 1));
    t.ok(
        "open",
        and(shows(WORK, "w.w", 2), json!({ "width": "1/2" })),
    );
    assert_eq!(t.widths()[0], [Some("1/3"), Some("1/2")]);
    // Right of the Pane in front, at its width; under it; into its Group.
    t.ok("open", and(shows(WORK, "r.r", 3), from(&one)));
    t.ok("open", and(shows(HOME, "b.b", 4), from(&one)));
    let five = t.opened(and(shows(WORK, "g.g", 5), from(&one)));
    assert_eq!(t.layout()[0], [vec![1, 4], vec![5], vec![3], vec![2]]);
    assert_eq!(t.widths()[0][2], Some("2/3"));
    assert_eq!(t.grouping()[0], [1, 1, 0, 0]);
    // With no Pane in front the rule gives way: as the Flow says.
    let top = t.workspace(0);
    t.ok("open", and(shows(WORK, "b.b", 6), json!({ "on": top })));
    assert_eq!(t.layout()[0].last().unwrap(), &[6]);
    // A place named is the place.
    let beside = json!({ "place": { "to": "beside", "pane": five, "side": "left" } });
    t.ok("open", and(shows(WORK, "b.b", 7), beside));
    assert_eq!(t.layout()[0][1], [7]);

    // In the row: Work's Thread opens beside the Pane in front, by its
    // rule, not on Work's workspace; "project" sends another kind there.
    t.in_the_flow(Flow::Row);
    let eight = t.opened(and(
        shows(HOME, "a.a", 8),
        json!({ "place": { "to": "project", "project": HOME } }),
    ));
    t.ok("open", and(thread(HOME, 9), from(&eight)));
    t.ok("open", and(shows(HOME, "p.p", 10), from(&eight)));
    assert_eq!(t.layout()[1], [vec![8], vec![9], vec![10]]);
    // From a workspace another Project owns, the rule gives way: Work's
    // Pane goes home, into Work's own Group. One of no Project stands
    // where it is opened, as the row lets it.
    t.ok("open", and(shows(WORK, "b.b", 11), from(&eight)));
    assert_eq!(t.layout()[1], [vec![8], vec![9], vec![10]]);
    t.ok("open", of_none(and(shows(THIRD, "b.b", 12), from(&eight))));
    assert_eq!(t.layout()[1][0], [8, 12]);
    // What is opened for an Agent goes as an Agent's: last on its
    // Project's workspace, at its kind's width.
    let agents = and(from(&eight), json!({ "agents": true }));
    t.ok("open", and(shows(HOME, "r.r", 13), agents.clone()));
    assert_eq!(t.layout()[1].last().unwrap(), &[13]);
    assert_eq!(t.widths()[1].last().unwrap(), &Some("2/3"));

    // A list, a kind with no rule: its new column is the narrowest of
    // the Tiling's widths, for the Person and for an Agent; the width
    // named else. Under another Pane it has no column of its own.
    t.lists("l.l", "1/4");
    t.lists("w.w", "1/4");
    let fourteen = t.opened(and(shows(HOME, "l.l", 14), from(&eight)));
    t.ok("open", and(shows(HOME, "l.l", 15), agents));
    t.ok(
        "open",
        and(shows(HOME, "l.l", 16), json!({ "width": "1/2" })),
    );
    let under = json!({ "place": { "to": "beside", "pane": fourteen, "side": "below" } });
    t.ok("open", and(shows(HOME, "l.l", 17), under));
    // A list whose rule says a width opens at the rule's.
    t.ok("open", and(shows(HOME, "w.w", 18), from(&eight)));
    let width_of = |n: u64| {
        let at = t.layout()[1].iter().position(|c| c.contains(&n)).unwrap();
        t.widths()[1][at]
    };
    assert_eq!(
        [14, 15, 16, 17, 18].map(width_of),
        [
            Some("1/4"),
            Some("1/4"),
            Some("1/2"),
            Some("1/4"),
            Some("1/3")
        ]
    );
    t
}

fn clicks_and_keys() -> Tracing {
    let mut t = Tracing::new(
        20,
        "clicks-and-keys",
        "A Thread's Group holds what its Thread opens, and the Person's keys open \
         beside it (ADR 0134): a click in a Thread, or in a Pane in its Group, \
         opens into that Group; a key from either opens as a column of its own \
         right of the whole Group, in the Flow free and in the row alike. A rule \
         that opens into a Group wins over a key.",
    );
    t.led_by_threads();
    let key = |pane: &str| json!({ "from": pane, "via": "key" });
    // Each on a workspace of its own: the Thread's Group numbered `g`.
    for (at, flow, project, n, g) in [(0, Flow::Free, HOME, 0, 1), (1, Flow::Row, WORK, 10, 3)] {
        t.in_the_flow(flow);
        let on = t.bottom();
        let one = t.opened(and(shows(project, "a.a", n + 1), json!({ "on": on })));
        let two = t.opened(and(thread(project, n + 2), key(&one)));
        // By a click in the Thread, and in a Pane in its Group, into it.
        let three = t.opened(and(shows(project, "a.a", n + 3), clicked(&two)));
        t.ok("open", and(shows(project, "a.a", n + 4), clicked(&three)));
        // By a key from either, right of the whole Group, so the last
        // opened stands next to it.
        t.ok("open", and(shows(project, "a.a", n + 5), key(&two)));
        t.ok("open", and(shows(project, "a.a", n + 6), key(&three)));
        // Left out, as a key.
        t.ok(
            "open",
            and(shows(project, "a.a", n + 7), json!({ "from": two })),
        );
        let ns = |more: [u32; 7]| more.map(|m| vec![u64::from(n + m)]);
        assert_eq!(t.layout()[at], ns([1, 2, 3, 4, 7, 6, 5]));
        assert_eq!(t.grouping()[at][1..], [g, g, g, 0, 0, 0]);
    }
    // A rule that opens into a Group wins over a key.
    t.ruled("g.g", None, Some(Opens::Group));
    let thread_pane = t.pane(1, 1, 0);
    t.ok("open", and(shows(WORK, "g.g", 21), key(&thread_pane)));
    t
}

#[test]
fn the_traces_the_clients_copy_replays_are_what_the_engine_does() {
    let traces = [
        the_bottom_workspace(),
        beside_and_instead(),
        moves(),
        move_workspace(),
        project_row(),
        thread_groups(),
        group_keys(),
        fill_size_maximize_display(),
        group_edges(),
        take_over(),
        ran_before(),
        update(),
        own_group(),
        arranged(),
        placed_free(),
        placed_row(),
        moved_away(),
        refused_moves(),
        rules(),
        clicks_and_keys(),
    ];
    let steps = || traces.iter().flat_map(|t| &t.trace.steps);

    // Every command the client's copy runs is traced, and each way of
    // every place, side and mouse a passing step takes.
    let used: BTreeSet<&str> = steps()
        .filter_map(|step| step.method.strip_prefix("workspaces."))
        .filter(|method| METHODS.contains(method))
        .collect();
    assert_eq!(used, METHODS.iter().copied().collect());
    let mut ways = BTreeSet::new();
    for step in steps().filter(|step| step.refused.is_none()) {
        let params = &step.params;
        if let Some(to) = params["place"]["to"].as_str() {
            ways.insert(format!("place {to}"));
        }
        if let Some(side) = params["place"]["side"].as_str() {
            ways.insert(format!("side {side}"));
        }
        if let Some(toward) = params["toward"].as_str() {
            ways.insert(format!("toward {toward}"));
        }
        if step.method == "workspaces.move_pane" {
            ways.insert(format!(
                "grouped {}",
                params.get("grouped").unwrap_or(&Value::Null)
            ));
        }
    }
    let every = [
        "place column",
        "place stack",
        "place beside",
        "place workspace",
        "place project",
        "place own",
        "place free",
        "place group",
        "side above",
        "side below",
        "side left",
        "side right",
        "toward left",
        "toward right",
        "grouped null",
        "grouped true",
        "grouped false",
    ];
    for way in every {
        assert!(ways.contains(way), "No passing step takes {way}.");
    }

    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../traces");
    std::fs::create_dir_all(&folder).unwrap();
    let mut names = BTreeSet::new();
    let mut changed = Vec::new();
    for tracing in &traces {
        let name = format!("{:02}-{}.json", tracing.number, tracing.slug);
        assert!(names.insert(name.clone()), "Two scenarios are {name}.");
        let text = serde_json::to_string_pretty(&tracing.trace).unwrap() + "\n";
        let file = folder.join(&name);
        if std::fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
            std::fs::write(&file, text).unwrap();
            changed.push(format!("wrote {name}"));
        }
    }
    for entry in std::fs::read_dir(&folder).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if name.ends_with(".json") && !names.contains(&name) {
            std::fs::remove_file(&path).unwrap();
            changed.push(format!("removed {name}"));
        }
    }
    assert!(
        changed.is_empty(),
        "The traces were written anew: review them and run again, as cargo test does the \
         TypeScript types ({}).",
        changed.join(", ")
    );
}
