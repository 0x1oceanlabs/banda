//! The arrangement's commands, as functions of it with no store, and what
//! each client's copy of the model is held to (ADR 0088, decision 11).
//! `apply` calls the model functions the module's handlers call, as they
//! call them; `open` is the handler's own. `tests/traces.rs` records what
//! `apply` does as golden traces, and the client's copy,
//! `client/web/src/tiling/arrangement.ts`, replays them; compiled to
//! WebAssembly (T1), `apply` is what a client calls instead.
//!
//! What needs the module's store stays in the module: that it takes a
//! window's arrangement once, the workspaces set aside, the last Arrange
//! by Project that Undo puts back, the Agents' tools behind their walls,
//! the arrangement's upgrades as it is read, and the events. So does what
//! it knows of the kinds of Pane: its handler of `open` fills `grouped`
//! from the kind when it is left out, and that of `arrange` its `leads`
//! from those kinds; `apply` takes both as sent. A window sends them by
//! the kinds that open grouped (`PaneKind.grouped`), so its copy of the
//! model knows no kind.

use crate::model::{
    self, Arrangement, ColumnId, Opening, PaneId, Place, Seed, Shown, Toward, WorkspaceId,
};
use banda_kernel::{ProjectId, Refusal, decode};
use banda_look::columns::Display;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use ts_rs::TS;

/// The commands `apply` runs: the module's own, but for those that need
/// its store (`set_aside`, `bring_back`, `unarrange`) and the Agents'
/// tools.
pub const METHODS: &[&str] = &[
    "open",
    "close",
    "update",
    "move_pane",
    "move_column",
    "move_workspace",
    "size",
    "height",
    "even",
    "maximize",
    "display",
    "group",
    "regroup",
    "move_group",
    "fill",
    "tidy",
    "arrange",
    "take",
];

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Open {
    #[serde(flatten)]
    #[ts(flatten)]
    pub shows: Shown,
    /// Left out, a column on the right of the top workspace that shows a
    /// Pane of its Project, or of the empty one at the bottom.
    #[serde(default)]
    #[ts(optional)]
    pub place: Option<Place>,
    /// The Pane it shows in place of, which leaves.
    #[serde(default)]
    #[ts(optional)]
    pub instead: Option<PaneId>,
    /// A new column's width; left out, the look's.
    #[serde(default)]
    #[ts(optional)]
    pub width: Option<String>,
    /// A new Pane even when one shows the same: a New Thread, a New Pane,
    /// as a browser's new window.
    #[serde(default)]
    #[ts(optional)]
    pub again: Option<bool>,
    /// A new Pane's column is in a Group from the start: the one the place
    /// puts it in, else a Group of its own, as a Thread opens, so what its
    /// Agent opens joins a Group already there (ADR 0065, decision 7).
    /// Left out, as its kind declares.
    #[serde(default)]
    #[ts(optional)]
    pub grouped: Option<bool>,
}

#[derive(Deserialize, TS, JsonSchema)]
#[ts(export_to = "workspaces/")]
pub struct OnePane {
    /// The Pane's ID, as `panes` lists it.
    pub pane: PaneId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Update {
    pub pane: PaneId,
    pub args: Value,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct MovePane {
    pub pane: PaneId,
    pub place: Place,
    /// Beside a Pane at a Group's end, a column of its own lands inside
    /// that Pane's Group (`true`) or outside it (`false`), as the mouse
    /// let it go (ADR 0065, decision 5). Left out, as the place says.
    #[serde(default)]
    #[ts(optional)]
    pub grouped: Option<bool>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct MoveColumn {
    pub column: ColumnId,
    pub workspace: WorkspaceId,
    /// From the left, counted as if it had left its place; past the last,
    /// the last.
    pub index: usize,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct MoveWorkspace {
    pub workspace: WorkspaceId,
    /// From the top, counted as if it had left its place; past the last,
    /// the last above the empty one.
    pub index: usize,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Size {
    pub column: ColumnId,
    /// A share of the screen, such as `"1/2"`; left out, the look's.
    #[serde(default)]
    #[ts(optional)]
    pub width: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Height {
    pub pane: PaneId,
    /// A share of its column's height, such as `"1/3"`; left out, even.
    #[serde(default)]
    #[ts(optional)]
    pub height: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct OneColumn {
    pub column: ColumnId,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Maximize {
    pub column: ColumnId,
    pub full: bool,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct ShowAs {
    pub column: ColumnId,
    /// Left out, as the look says.
    #[serde(default)]
    #[ts(optional)]
    pub display: Option<Display>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Regroup {
    pub column: ColumnId,
    pub toward: Toward,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Fill {
    pub column: ColumnId,
    pub fill: bool,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Tidy {
    /// The workspace the Person looks at, which stays even empty.
    #[serde(default)]
    #[ts(optional)]
    pub keep: Option<WorkspaceId>,
    /// The Projects whose workspace stays even empty, as they have Threads
    /// (ADR 0102, decision 2). Left out, none.
    #[serde(default)]
    #[ts(as = "Option<Vec<ProjectId>>", optional)]
    pub projects: Vec<ProjectId>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Arrange {
    /// The Projects that have a workspace of their own; any other's Panes,
    /// as one of no Project's (ADR 0046), go to a free one.
    #[serde(default)]
    #[ts(as = "Option<Vec<ProjectId>>", optional)]
    pub projects: Vec<ProjectId>,
    /// Only this Project's Panes move, as a Thread of no Project made a
    /// Project's does (ADR 0102, decision 7). Left out, every Project's.
    #[serde(default)]
    #[ts(optional)]
    pub only: Option<ProjectId>,
    /// The kinds of Pane that lead a Group, as an Agent's Thread does: the
    /// Group is its lead's Project's, and one with none is the Person's
    /// own (ADR 0102, decisions 4 and 6). Left out, those that open as a
    /// Group of their own.
    #[serde(default)]
    #[ts(optional)]
    pub leads: Option<Vec<String>>,
}

#[derive(Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Take {
    pub workspaces: Arrangement,
}

/// Opens a Pane as `workspaces.open` says; answers it, and whether it is
/// new. One the workspaces show already is only named, and keeps the Group
/// it is in or not.
pub fn open(list: &mut Arrangement, open: Open, seed: &Seed) -> Result<(PaneId, bool), Refusal> {
    let again = open.again == Some(true) || open.instead.is_some();
    let new = again || model::showing(list, &open.shows).is_none();
    let Open {
        shows,
        place,
        instead,
        width,
        grouped,
        ..
    } = open;
    let opening = Opening {
        shown: shows,
        place,
        instead,
        width,
        again,
        by: None,
    };
    let pane = model::open(list, opening, seed)?;
    if new && grouped == Some(true) {
        model::group_pane(list, pane, seed)?;
    }
    Ok((pane, new))
}

/// Runs the command `method`, one of `METHODS`, with its params, as the
/// module runs it, and answers as it does: `{"pane", "new"}` for `open`,
/// `{}` for the rest. A refused command may leave `list` half changed, as the
/// model's functions do: keep it only when the command passes.
pub fn apply(
    list: &mut Arrangement,
    method: &str,
    params: Value,
    seed: &Seed,
) -> Result<Value, Refusal> {
    match method {
        "open" => {
            let opening: Open = read(list, seed, params)?;
            let (pane, new) = open(list, opening, seed)?;
            return Ok(json!({ "pane": pane, "new": new }));
        }
        "close" => {
            let OnePane { pane } = read(list, seed, params)?;
            model::close(list, pane, seed)?;
        }
        "update" => {
            let Update { pane, args } = read(list, seed, params)?;
            model::update(list, pane, args)?;
        }
        "move_pane" => {
            let MovePane {
                pane,
                place,
                grouped,
            } = read(list, seed, params)?;
            model::move_pane(list, pane, &place, grouped, seed)?;
        }
        "move_column" => {
            let MoveColumn {
                column,
                workspace,
                index,
            } = read(list, seed, params)?;
            model::move_column(list, column, workspace, index, seed)?;
        }
        "move_workspace" => {
            let MoveWorkspace { workspace, index } = read(list, seed, params)?;
            model::move_workspace(list, workspace, index)?;
        }
        "size" => {
            let Size { column, width } = read(list, seed, params)?;
            model::size(list, column, width)?;
        }
        "height" => {
            let Height { pane, height } = read(list, seed, params)?;
            model::height(list, pane, height)?;
        }
        "even" => {
            let OneColumn { column } = read(list, seed, params)?;
            model::even(list, column)?;
        }
        "maximize" => {
            let Maximize { column, full } = read(list, seed, params)?;
            model::maximize(list, column, full)?;
        }
        "display" => {
            let ShowAs { column, display } = read(list, seed, params)?;
            model::display(list, column, display)?;
        }
        "group" => {
            let OneColumn { column } = read(list, seed, params)?;
            model::group(list, column, seed)?;
        }
        "regroup" => {
            let Regroup { column, toward } = read(list, seed, params)?;
            model::regroup(list, column, toward)?;
        }
        "move_group" => {
            let MoveColumn {
                column,
                workspace,
                index,
            } = read(list, seed, params)?;
            model::move_group(list, column, workspace, index, seed)?;
        }
        "fill" => {
            let Fill { column, fill } = read(list, seed, params)?;
            model::fill(list, column, fill)?;
        }
        "tidy" => {
            let Tidy { keep, projects } = read(list, seed, params)?;
            model::tidy(list, keep, &projects);
        }
        "arrange" => {
            let Arrange {
                projects,
                only,
                leads,
            } = read(list, seed, params)?;
            model::arrange(list, &projects, only, &leads.unwrap_or_default(), seed);
        }
        "take" => {
            let Take { workspaces } = read(list, seed, params)?;
            model::take(list, workspaces, seed)?;
        }
        other => {
            return Err(Refusal::invalid(format!(
                "The arrangement takes no command \"{other}\"."
            )));
        }
    }
    Ok(json!({}))
}

/// A command's params, read as the module reads them: first, then whether
/// the command ran before (`Seed::unused`), as the kernel reads them before
/// the module's handler runs.
fn read<T: DeserializeOwned>(list: &Arrangement, seed: &Seed, params: Value) -> Result<T, Refusal> {
    let read = decode(params)?;
    seed.unused(list)?;
    Ok(read)
}
