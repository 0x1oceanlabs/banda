//! The workspaces' arrangement, as niri lays it out (ADR 0005, decisions 5
//! and 7; ADR 0025, decision 1), and the rules that hold whatever the look:
//!
//! - the workspaces sit one under another, and the last one is always
//!   empty;
//! - a workspace is a Strip of columns, each holding its Panes, and a
//!   column with no Pane goes;
//! - a Pane opens once: opening one the workspaces show already names the
//!   one shown, unless it opens `again`, as a new Thread does each time;
//! - a Group's columns stand side by side on one workspace, and move as
//!   one (ADR 0065).
//!
//! An empty workspace in the middle stays until the window tidies: the
//! window knows which one the Person looks at, and the engine does not.
//! What depends on the look or the view stays the window's: the widths a
//! column is drawn at, the focus, the scroll.
//!
//! Every change is a function of the arrangement, so plain tests cover the
//! rules. A refused change may leave it half done: the module keeps it
//! only when the change is done.

use banda_kernel::{AgentId, Refusal, SpaceId, Wall};
use banda_look::columns::{Display, share};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

banda_kernel::id!(
    /// A workspace's ID.
    WorkspaceId, export_to = "workspaces/"
);
banda_kernel::id!(
    /// A column's ID, which it keeps as it moves.
    ColumnId, export_to = "workspaces/"
);
banda_kernel::id!(
    /// A Pane's ID, which it keeps as it moves.
    PaneId, export_to = "workspaces/"
);
banda_kernel::id!(
    /// A Group's ID: columns side by side that move and look as one (ADR
    /// 0065).
    GroupId, export_to = "workspaces/"
);

/// The workspaces from the top down.
pub type Arrangement = Vec<Workspace>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Workspace {
    pub id: WorkspaceId,
    /// Its Strip, from the left.
    pub columns: Vec<Column>,
    /// The Group that takes the whole screen, its columns keeping their
    /// shares of it, as `Alt+M` (ADR 0065). Left out, none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub filled: Option<GroupId>,
    /// The Space whose Agents' Threads open here, in a row (ADR 0065,
    /// decision 9). It holds Panes of any Space still. Left out, none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub space: Option<SpaceId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Column {
    pub id: ColumnId,
    /// From the top; never none.
    pub panes: Vec<Pane>,
    /// The share of the screen the Person gave it, such as `"1/2"`. Left
    /// out, the look's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub width: Option<String>,
    /// It takes the whole screen over its width.
    #[serde(default)]
    pub full: bool,
    /// How it shows its Panes. Left out, as the look says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub display: Option<Display>,
    /// The Group it is in, with the columns beside it that name it too
    /// (ADR 0065). Left out, none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub group: Option<GroupId>,
}

/// One Pane: what it shows, the Space it belongs to, and the Agent that
/// opened it, if one did.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Pane {
    pub id: PaneId,
    #[serde(flatten)]
    #[ts(flatten)]
    pub shows: Shown,
    /// The Agent that opened it, which alone of the Agents moves and
    /// closes it (ADR 0032). Left out, its Person opened it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub by: Option<AgentId>,
    /// The share of its column's height the Person gave it, such as
    /// `"1/3"`. Left out, it shares what the others leave evenly with the
    /// rest left out (ADR 0025, decision 4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub height: Option<String>,
}

/// How much of a Pane a caller sees (ADR 0032).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sight {
    /// All of it: the owner, or an Agent of its Space.
    Whole,
    /// Where it is and what it is, not its args: an Agent of another
    /// Space whose Person lets it see the others.
    Outline,
    /// Nothing: behind the wall.
    Hidden,
}

/// How much of `pane` a caller behind `wall` sees.
pub fn sight(wall: Option<Wall>, pane: &Pane) -> Sight {
    match wall {
        None => Sight::Whole,
        Some(wall) if wall.space == pane.shows.space => Sight::Whole,
        Some(wall) if wall.sees_others => Sight::Outline,
        Some(_) => Sight::Hidden,
    }
}

/// The Pane `pane`, when a caller behind `wall` sees it; a Pane it does
/// not is as if the workspaces did not show it.
pub fn seen(list: &Arrangement, wall: Wall, pane: PaneId) -> Result<&Pane, Refusal> {
    panes(list)
        .find(|other| other.id == pane && sight(Some(wall), other) != Sight::Hidden)
        .ok_or_else(|| Refusal::not_found("The workspaces show no such Pane."))
}

/// What a Pane shows: two Panes are the same when this is.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "workspaces/")]
pub struct Shown {
    pub space: SpaceId,
    /// Its kind, `<module>.<pane>`.
    pub kind: String,
    /// The kind's own: an object.
    pub args: Value,
}

impl Shown {
    /// The Pane a kind gone shows now: `agents.diff`, one turn's changes,
    /// is the Diff on that Turn (ADR 0034).
    pub fn upgrade(&mut self) {
        if self.kind != "agents.diff" {
            return;
        }
        let arg = |name: &str| self.args.get(name).cloned().unwrap_or(Value::Null);
        let (thread, turn, title) = (arg("thread"), arg("turn"), arg("title"));
        self.kind = "git.diff".into();
        self.args = serde_json::json!({
            "scope": { "kind": "turn", "thread": thread, "turn": turn, "title": title },
        });
    }
}

/// Where a Pane goes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "to", rename_all = "lowercase")]
#[ts(export_to = "workspaces/")]
pub enum Place {
    /// A column of its own on a workspace, `index` from the left; past the
    /// last, the last.
    Column {
        workspace: WorkspaceId,
        index: usize,
    },
    /// In a column, `index` from the top; past the last, the last.
    Stack { column: ColumnId, index: usize },
    /// Beside a Pane.
    Beside { pane: PaneId, side: Side },
    /// A column of its own on a new workspace, `index` from the top: as
    /// one dropped between two in the overview. Never under the empty one
    /// at the bottom.
    Workspace { index: usize },
    /// Last on a Space's workspace, where its Agents' Threads open (ADR
    /// 0065, decision 9): the one it owns; else the top one that shows its
    /// Panes and is no other Space's, or the empty one at the bottom,
    /// which it owns then.
    Space { space: SpaceId },
    /// In the Group of a Pane, as what a Thread opens goes (ADR 0065,
    /// decision 7): its column starts a Group if it is in none, and the
    /// Panes go last into the Group's column right of it, or into a new
    /// one there, shown as a Deck.
    Group { pane: PaneId },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export_to = "workspaces/")]
pub enum Side {
    /// In its column, over it.
    Above,
    /// In its column, under it.
    Below,
    /// A column of its own, left of its column.
    Left,
    /// A column of its own, right of its column.
    Right,
}

/// The first arrangement: one empty workspace.
pub fn start() -> Arrangement {
    vec![blank()]
}

fn blank() -> Workspace {
    Workspace {
        id: WorkspaceId::new(),
        columns: Vec::new(),
        filled: None,
        space: None,
    }
}

/// Where a Pane is: its workspace, its column and its place in it.
struct Spot {
    workspace: usize,
    column: usize,
    pane: usize,
}

fn spot(list: &Arrangement, pane: PaneId) -> Result<Spot, Refusal> {
    list.iter()
        .enumerate()
        .find_map(|(w, workspace)| {
            workspace
                .columns
                .iter()
                .enumerate()
                .find_map(|(c, column)| {
                    let p = column.panes.iter().position(|other| other.id == pane)?;
                    Some(Spot {
                        workspace: w,
                        column: c,
                        pane: p,
                    })
                })
        })
        .ok_or_else(|| Refusal::not_found("The workspaces show no such Pane."))
}

fn column_at(list: &Arrangement, column: ColumnId) -> Result<(usize, usize), Refusal> {
    list.iter()
        .enumerate()
        .find_map(|(w, workspace)| {
            let c = workspace.columns.iter().position(|c| c.id == column)?;
            Some((w, c))
        })
        .ok_or_else(|| Refusal::not_found("The workspaces have no such column."))
}

fn column_mut(list: &mut Arrangement, column: ColumnId) -> Result<&mut Column, Refusal> {
    let (w, c) = column_at(list, column)?;
    Ok(&mut list[w].columns[c])
}

fn workspace_at(list: &Arrangement, workspace: WorkspaceId) -> Result<usize, Refusal> {
    list.iter()
        .position(|w| w.id == workspace)
        .ok_or_else(|| Refusal::not_found("There is no such workspace."))
}

fn panes_of(workspace: &Workspace) -> impl Iterator<Item = &Pane> {
    workspace.columns.iter().flat_map(|c| &c.panes)
}

/// Every Pane of `list`, workspace by workspace, from the left and the top.
pub fn panes(list: &Arrangement) -> impl Iterator<Item = &Pane> {
    list.iter().flat_map(panes_of)
}

/// The Pane the workspaces show that shows `shown`, if one does.
pub fn showing<'a>(list: &'a Arrangement, shown: &Shown) -> Option<&'a Pane> {
    panes(list).find(|pane| pane.shows == *shown)
}

/// Shows a Pane at `place`, or `instead` of another, which leaves; and
/// names it. One the workspaces show already stays where it is, and is
/// named, unless it opens `again` or `instead`. Left with neither, it
/// opens as a column on the right of the top workspace that shows a Pane
/// of its Space, or else on the empty one at the bottom. `width` is a new
/// column's; `by`, the Agent that opens a new one.
pub fn open(
    list: &mut Arrangement,
    shown: Shown,
    place: Option<Place>,
    instead: Option<PaneId>,
    width: Option<String>,
    again: bool,
    by: Option<AgentId>,
) -> Result<PaneId, Refusal> {
    check_shown(&shown)?;
    check_width(width.as_deref())?;
    if place.is_some() && instead.is_some() {
        return Err(Refusal::invalid(
            "A Pane opens at a place or instead of another, not both.",
        ));
    }
    if let Some(pane) = showing(list, &shown).filter(|_| !again && instead.is_none()) {
        return Ok(pane.id);
    }
    let pane = Pane {
        id: PaneId::new(),
        shows: shown,
        by,
        height: None,
    };
    let id = pane.id;
    if let Some(other) = instead {
        let at = spot(list, other)?;
        list[at.workspace].columns[at.column].panes[at.pane] = pane;
    } else {
        let place = place.unwrap_or_else(|| Place::Column {
            workspace: list[showing_space(list, pane.shows.space, |_| true)].id,
            index: usize::MAX,
        });
        put(list, new_column(pane, width), &place, None)?;
    }
    normalize(list);
    Ok(id)
}

fn new_column(pane: Pane, width: Option<String>) -> Column {
    Column {
        id: ColumnId::new(),
        panes: vec![pane],
        width,
        full: false,
        display: None,
        group: None,
    }
}

/// Puts a column at `place`: as it is when the place is a column's own,
/// or its Panes into another column.
/// `grouped`, beside a Pane at a Group's end, says whether a column of its
/// own goes inside that Pane's Group or out of it, as the mouse let it go
/// (ADR 0065, decision 5).
fn put(
    list: &mut Arrangement,
    column: Column,
    place: &Place,
    grouped: Option<bool>,
) -> Result<(), Refusal> {
    match *place {
        Place::Column { workspace, index } => {
            let w = workspace_at(list, workspace)?;
            let at = index.min(list[w].columns.len());
            list[w].columns.insert(at, column);
            settle(list, w, at, None);
        }
        Place::Stack {
            column: into,
            index,
        } => {
            let panes = &mut column_mut(list, into)?.panes;
            let at = index.min(panes.len());
            panes.splice(at..at, column.panes);
        }
        Place::Beside { pane, side } => {
            let at = spot(list, pane)?;
            let columns = &mut list[at.workspace].columns;
            match side {
                Side::Above | Side::Below => {
                    let index = at.pane + usize::from(side == Side::Below);
                    columns[at.column].panes.splice(index..index, column.panes);
                }
                Side::Left | Side::Right => {
                    let index = at.column + usize::from(side == Side::Right);
                    let by = columns[at.column].group;
                    columns.insert(index, column);
                    let into = grouped.map(|inside| by.filter(|_| inside));
                    settle(list, at.workspace, index, into);
                }
            }
        }
        Place::Workspace { index } => {
            let mut workspace = blank();
            workspace.columns.push(column);
            list.insert(above_empty(list, index), workspace);
        }
        Place::Space { space } => {
            let owned = |w: &Workspace| w.space == Some(space) && !w.columns.is_empty();
            let w = (list.iter().position(owned)).unwrap_or_else(|| {
                showing_space(list, space, |w| w.space.is_none_or(|other| other == space))
            });
            list[w].space = Some(space);
            let workspace = list[w].id;
            put(
                list,
                column,
                &Place::Column {
                    workspace,
                    index: usize::MAX,
                },
                None,
            )?;
        }
        Place::Group { pane } => {
            let at = spot(list, pane)?;
            let columns = &mut list[at.workspace].columns;
            let group = *columns[at.column].group.get_or_insert_with(GroupId::new);
            let next = at.column + 1;
            match columns.get_mut(next).filter(|c| c.group == Some(group)) {
                Some(deck) => deck.panes.extend(column.panes),
                None => columns.insert(
                    next,
                    Column {
                        group: Some(group),
                        display: Some(Display::Deck),
                        ..column
                    },
                ),
            }
        }
    }
    Ok(())
}

/// The top workspace that shows a Pane of `space` and is `free`, else the
/// empty one at the bottom.
fn showing_space(list: &Arrangement, space: SpaceId, free: impl Fn(&Workspace) -> bool) -> usize {
    (list.iter())
        .position(|w| free(w) && panes_of(w).any(|p| p.shows.space == space))
        .unwrap_or(list.len() - 1)
}

/// Closes a Pane. Its column goes when it was the last there.
pub fn close(list: &mut Arrangement, pane: PaneId) -> Result<(), Refusal> {
    let at = spot(list, pane)?;
    list[at.workspace].columns[at.column].panes.remove(at.pane);
    normalize(list);
    Ok(())
}

/// Keeps new args for a Pane, which stays where it is. Another Pane may
/// show the same then: a Pane opens once, but its args are its kind's.
pub fn update(list: &mut Arrangement, pane: PaneId, args: Value) -> Result<(), Refusal> {
    let at = spot(list, pane)?;
    let shows = &mut list[at.workspace].columns[at.column].panes[at.pane].shows;
    check_shown(&Shown {
        args: args.clone(),
        ..shows.clone()
    })?;
    shows.args = args;
    Ok(())
}

/// The args a Pane shows, if the workspaces show it.
pub fn args_of(list: &Arrangement, pane: PaneId) -> Option<&Value> {
    panes(list).find(|p| p.id == pane).map(|p| &p.shows.args)
}

/// Moves a Pane to `place`, counted as if it had left its own already.
/// Alone in its column, it takes the column along to a place of a column's
/// own, with its width and display; in its column's stack, it changes
/// places there.
pub fn move_pane(
    list: &mut Arrangement,
    pane: PaneId,
    place: &Place,
    grouped: Option<bool>,
) -> Result<(), Refusal> {
    if matches!(*place, Place::Beside { pane: other, .. } if other == pane) {
        return Err(Refusal::invalid("A Pane moves beside another, not itself."));
    }
    let at = spot(list, pane)?;
    let here = list[at.workspace].id;
    let from = &mut list[at.workspace].columns;
    let mut moving = from[at.column].panes.remove(at.pane);
    // Its height was of the column it leaves.
    moving.height = None;
    let column = if from[at.column].panes.is_empty() {
        if matches!(*place, Place::Stack { column, .. } if column == from[at.column].id) {
            from[at.column].panes.push(moving);
            return Ok(());
        }
        let mut column = from.remove(at.column);
        column.panes = vec![moving];
        column
    } else {
        // Taken out of its column to one of its own beside it, a Pane
        // stays in the column's Group (ADR 0065, decision 4).
        let own = &from[at.column];
        let beside = match *place {
            Place::Column { workspace, index } => {
                workspace == here && (index == at.column || index == at.column + 1)
            }
            Place::Beside { pane, side } => {
                matches!(side, Side::Left | Side::Right) && own.panes.iter().any(|p| p.id == pane)
            }
            _ => false,
        };
        let group = own.group.filter(|_| beside);
        Column {
            group,
            ..new_column(moving, None)
        }
    };
    put(list, column, place, grouped)?;
    normalize(list);
    Ok(())
}

/// Whether the column at `c` stands with one Group's columns on both
/// sides of it. (`inside` asks it of the gap before a column.)
fn flanked(columns: &[Column], c: usize) -> bool {
    let left = c.checked_sub(1).and_then(|i| columns[i].group);
    left.is_some() && columns.get(c + 1).and_then(|o| o.group) == left
}

/// Moves a column to a workspace, `index` from the left, counted as if it
/// had left its place already; past the last, the last.
pub fn move_column(
    list: &mut Arrangement,
    column: ColumnId,
    workspace: WorkspaceId,
    index: usize,
) -> Result<(), Refusal> {
    let (w, c) = column_at(list, column)?;
    let moving = list[w].columns.remove(c);
    put(list, moving, &Place::Column { workspace, index }, None)?;
    normalize(list);
    Ok(())
}

/// Moves a workspace, its columns and all, `index` from the top, counted
/// as if it had left its place already: as niri's `move-workspace-up`, or
/// one dragged in the overview. Past the last, the last above the empty
/// one at the bottom, which stays where it is.
pub fn move_workspace(
    list: &mut Arrangement,
    workspace: WorkspaceId,
    index: usize,
) -> Result<(), Refusal> {
    let w = workspace_at(list, workspace)?;
    if w + 1 == list.len() {
        return Err(Refusal::invalid(
            "The empty workspace at the bottom stays there.",
        ));
    }
    let moving = list.remove(w);
    list.insert(above_empty(list, index), moving);
    Ok(())
}

/// Gives a column its width, left out for the look's; it no longer takes
/// the whole screen, as niri's.
pub fn size(
    list: &mut Arrangement,
    column: ColumnId,
    width: Option<String>,
) -> Result<(), Refusal> {
    check_width(width.as_deref())?;
    let (w, c) = column_at(list, column)?;
    // A Group that filled the screen no longer does: its columns' shares
    // change.
    if list[w].filled.is_some() && list[w].filled == list[w].columns[c].group {
        list[w].filled = None;
    }
    let column = &mut list[w].columns[c];
    column.width = width;
    column.full = false;
    Ok(())
}

/// Gives a Pane its share of its column's height, left out for an even
/// one, as niri's window heights.
pub fn height(list: &mut Arrangement, pane: PaneId, height: Option<String>) -> Result<(), Refusal> {
    check_height(height.as_deref())?;
    let at = spot(list, pane)?;
    list[at.workspace].columns[at.column].panes[at.pane].height = height;
    Ok(())
}

/// Makes every Pane of a column as high as the others.
pub fn even(list: &mut Arrangement, column: ColumnId) -> Result<(), Refusal> {
    for pane in &mut column_mut(list, column)?.panes {
        pane.height = None;
    }
    Ok(())
}

/// Whether a column takes the whole screen; its width stays for after.
pub fn maximize(list: &mut Arrangement, column: ColumnId, full: bool) -> Result<(), Refusal> {
    column_mut(list, column)?.full = full;
    Ok(())
}

/// Shows a column's Panes one above another or as a Deck; left out, as the
/// look says.
pub fn display(
    list: &mut Arrangement,
    column: ColumnId,
    display: Option<Display>,
) -> Result<(), Refusal> {
    column_mut(list, column)?.display = display;
    Ok(())
}

/// Which way a column leaves its Group, or joins the one beside it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export_to = "workspaces/")]
pub enum Toward {
    Left,
    Right,
}

/// The columns of the Group the one at `c` is in, as a range of
/// `columns`: it alone when it is in none.
fn run(columns: &[Column], c: usize) -> std::ops::Range<usize> {
    let Some(group) = columns[c].group else {
        return c..c + 1;
    };
    let start = (columns[..c].iter())
        .rposition(|other| other.group != Some(group))
        .map_or(0, |i| i + 1);
    let end = (columns[c..].iter())
        .position(|other| other.group != Some(group))
        .map_or(columns.len(), |i| c + i);
    start..end
}

/// A column just put at `at` of workspace `w` joins the Group whose
/// columns stand on both sides of it, as one put inside a Group does;
/// else it goes `into` the Group the mouse said, or none; else it leaves
/// its own when that Group's other columns stand elsewhere.
fn settle(list: &mut Arrangement, w: usize, at: usize, into: Option<Option<GroupId>>) {
    let columns = &list[w].columns;
    let left = at.checked_sub(1).and_then(|i| columns[i].group);
    let right = columns.get(at + 1).and_then(|other| other.group);
    if flanked(columns, at) {
        list[w].columns[at].group = left;
        return;
    }
    if let Some(group) = into {
        list[w].columns[at].group = group;
        return;
    }
    let Some(own) = columns[at].group else {
        return;
    };
    let beside = left == Some(own) || right == Some(own);
    let elsewhere = list.iter().enumerate().any(|(v, workspace)| {
        (workspace.columns.iter().enumerate())
            .any(|(i, other)| other.group == Some(own) && (v, i) != (w, at))
    });
    if !beside && elsewhere {
        list[w].columns[at].group = None;
    }
}

/// Whether `at`, a place between two columns, stands inside a Group:
/// between two of its columns.
fn inside(columns: &[Column], at: usize) -> bool {
    let left = at
        .checked_sub(1)
        .and_then(|i| columns.get(i))
        .and_then(|c| c.group);
    left.is_some() && columns.get(at).and_then(|c| c.group) == left
}

/// Starts a Group of a column alone, as `Alt+G`, for others to join; one
/// in a Group stays in it.
pub fn group(list: &mut Arrangement, column: ColumnId) -> Result<(), Refusal> {
    column_mut(list, column)?
        .group
        .get_or_insert_with(GroupId::new);
    Ok(())
}

/// A column in a Group leaves it `toward` that side, past its Group's
/// columns there; one in none joins the Group beside it that way, as
/// `Alt+Shift+[` and `]` (ADR 0065).
pub fn regroup(list: &mut Arrangement, column: ColumnId, toward: Toward) -> Result<(), Refusal> {
    let (w, c) = column_at(list, column)?;
    let columns = &mut list[w].columns;
    if columns[c].group.is_some() {
        let group = run(columns, c);
        let mut leaving = columns.remove(c);
        leaving.group = None;
        let at = match toward {
            Toward::Left => group.start,
            Toward::Right => group.end - 1,
        };
        columns.insert(at, leaving);
        return Ok(());
    }
    let beside = match toward {
        Toward::Left => c.checked_sub(1),
        Toward::Right => Some(c + 1),
    };
    let Some(group) = beside.and_then(|b| columns.get(b)).and_then(|o| o.group) else {
        return Err(Refusal::invalid(
            "No Group stands beside the column that way.",
        ));
    };
    columns[c].group = Some(group);
    Ok(())
}

/// Moves the Group a column is in, its columns all and in their order, to
/// a workspace, `index` from the left, counted as if it had left its
/// place; a place inside another Group is past it, as Groups don't nest.
/// A column in none moves as `move_column` moves it.
pub fn move_group(
    list: &mut Arrangement,
    column: ColumnId,
    workspace: WorkspaceId,
    index: usize,
) -> Result<(), Refusal> {
    let (w, c) = column_at(list, column)?;
    let Some(group) = list[w].columns[c].group else {
        return move_column(list, column, workspace, index);
    };
    let to = workspace_at(list, workspace)?;
    let group_run = run(&list[w].columns, c);
    let moving: Vec<Column> = list[w].columns.drain(group_run).collect();
    if list[w].filled == Some(group) {
        list[w].filled = None;
        list[to].filled = Some(group);
    }
    let columns = &mut list[to].columns;
    let mut at = index.min(columns.len());
    if inside(columns, at) {
        at = run(columns, at).end;
    }
    columns.splice(at..at, moving);
    normalize(list);
    Ok(())
}

/// Whether the Group a column is in takes the whole screen, its columns
/// keeping their shares of it, as `Alt+M`; their widths stay for after.
pub fn fill(list: &mut Arrangement, column: ColumnId, fill: bool) -> Result<(), Refusal> {
    let (w, c) = column_at(list, column)?;
    let Some(group) = list[w].columns[c].group else {
        return Err(Refusal::invalid("The column is in no Group."));
    };
    list[w].filled = fill.then_some(group);
    Ok(())
}

/// Lets every empty workspace go but `keep`, the one the Person looks at,
/// and the last.
pub fn tidy(list: &mut Arrangement, keep: Option<WorkspaceId>) {
    let last = list.last().map(|w| w.id);
    list.retain(|w| !w.columns.is_empty() || Some(w.id) == keep || Some(w.id) == last);
}

/// Puts a window's arrangement over the engine's (ADR 0025, decision 2).
/// A Pane shown twice is kept the first time.
pub fn take(list: &mut Arrangement, taken: Arrangement) -> Result<(), Refusal> {
    let mut all: Arrangement = taken;
    all.append(list);
    let mut seen: Vec<Shown> = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for workspace in &mut all {
        for column in &mut workspace.columns {
            column.panes.retain(|pane| {
                let twice = seen.contains(&pane.shows);
                if !twice {
                    seen.push(pane.shows.clone());
                }
                !twice
            });
        }
    }
    for workspace in &all {
        let mut fresh = ids.insert(workspace.id.to_string());
        for column in &workspace.columns {
            check_width(column.width.as_deref())?;
            fresh &= ids.insert(column.id.to_string());
            for pane in &column.panes {
                check_shown(&pane.shows)?;
                check_height(pane.height.as_deref())?;
                fresh &= ids.insert(pane.id.to_string());
            }
        }
        if !fresh {
            return Err(Refusal::invalid(
                "Each workspace, column and Pane needs an ID of its own.",
            ));
        }
    }
    normalize(&mut all);
    // Of the empty workspaces, only the last stays.
    tidy(&mut all, None);
    *list = all;
    Ok(())
}

/// `index` from the top, or past the last, the last above the empty
/// workspace at the bottom.
fn above_empty(list: &Arrangement, index: usize) -> usize {
    index.min(list.len().saturating_sub(1))
}

/// Keeps the rules: a column with no Pane goes, the last workspace is an
/// empty one, and a Group's columns stand side by side on one workspace:
/// a column of a Group that stands apart from the rest of it leaves it.
fn normalize(list: &mut Arrangement) {
    let mut groups = std::collections::HashSet::new();
    for workspace in list.iter_mut() {
        workspace.columns.retain(|c| !c.panes.is_empty());
        let mut before = None;
        for column in &mut workspace.columns {
            if let Some(group) = column.group
                && before != Some(group)
                && !groups.insert(group)
            {
                column.group = None;
            }
            before = column.group;
        }
        if let Some(filled) = workspace.filled
            && !workspace.columns.iter().any(|c| c.group == Some(filled))
        {
            workspace.filled = None;
        }
    }
    if list.last().is_none_or(|w| !w.columns.is_empty()) {
        list.push(blank());
    }
}

fn check_shown(shown: &Shown) -> Result<(), Refusal> {
    let kind = &shown.kind;
    if kind
        .split_once('.')
        .is_none_or(|(m, p)| m.is_empty() || p.is_empty())
    {
        return Err(Refusal::invalid(format!(
            "\"{kind}\" is no Pane's kind: it is <module>.<pane>."
        )));
    }
    if !shown.args.is_object() {
        return Err(Refusal::invalid("A Pane's args are an object."));
    }
    Ok(())
}

fn check_width(width: Option<&str>) -> Result<(), Refusal> {
    check_share(width, "width", "screen")
}

fn check_height(height: Option<&str>) -> Result<(), Refusal> {
    check_share(height, "height", "column")
}

fn check_share(value: Option<&str>, what: &str, of: &str) -> Result<(), Refusal> {
    match value {
        Some(value) if share(value).is_none() => Err(Refusal::invalid(format!(
            "\"{value}\" is no {what}: a share of the {of}, such as \"1/2\" or \"1\"."
        ))),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_turn_s_changes_kept_from_before_open_as_the_diff_on_that_turn() {
        let space = SpaceId::new();
        let mut old = Shown {
            space,
            kind: "agents.diff".into(),
            args: json!({ "thread": "t", "turn": "u", "path": "a.ts", "title": "Fix" }),
        };
        old.upgrade();
        assert_eq!(old.kind, "git.diff");
        assert_eq!(
            old.args,
            json!({
                "scope": { "kind": "turn", "thread": "t", "turn": "u", "title": "Fix" },
            })
        );
        let mut other = shown(space, "browser.browser", 1);
        other.upgrade();
        assert_eq!(other, shown(space, "browser.browser", 1));
    }

    fn shown(space: SpaceId, kind: &str, n: u32) -> Shown {
        Shown {
            space,
            kind: kind.to_owned(),
            args: json!({ "n": n }),
        }
    }

    /// Each workspace's columns, each column's Panes by their args' `n`.
    fn layout(list: &Arrangement) -> Vec<Vec<Vec<u64>>> {
        list.iter()
            .map(|w| {
                (w.columns.iter())
                    .map(|c| {
                        c.panes
                            .iter()
                            .map(|p| p.shows.args["n"].as_u64().unwrap())
                            .collect()
                    })
                    .collect()
            })
            .collect()
    }

    /// A workspace with no column.
    const EMPTY: Vec<Vec<u64>> = Vec::new();

    fn opened(list: &mut Arrangement, shown: Shown, place: Option<Place>) -> PaneId {
        open(list, shown, place, None, None, false, None).unwrap()
    }

    fn beside(pane: PaneId, side: Side) -> Option<Place> {
        Some(Place::Beside { pane, side })
    }

    #[test]
    fn a_pane_keeps_its_height_in_its_column_until_it_leaves_or_all_are_even() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        let two = opened(&mut list, shown(work, "a.a", 2), beside(one, Side::Below));
        let three = opened(&mut list, shown(work, "a.a", 3), beside(two, Side::Below));
        let height_of = |list: &Arrangement, pane| {
            let at = spot(list, pane).unwrap();
            list[at.workspace].columns[at.column].panes[at.pane]
                .height
                .clone()
        };
        height(&mut list, two, Some("1/3".into())).unwrap();
        height(&mut list, three, Some("1/2".into())).unwrap();
        assert_eq!(height_of(&list, two).as_deref(), Some("1/3"));
        assert!(height(&mut list, one, Some("3/2".into())).is_err());
        assert_eq!(height_of(&list, one), None);

        // Moved to a column of its own, it leaves its height behind.
        move_pane(&mut list, three, &beside(one, Side::Right).unwrap(), None).unwrap();
        assert_eq!(height_of(&list, three), None);
        let column = list[0].columns[0].id;
        even(&mut list, column).unwrap();
        assert_eq!(height_of(&list, two), None);
    }

    #[test]
    fn a_pane_opens_on_the_bottom_workspace_and_a_new_empty_one_comes() {
        let mut list = start();
        let bottom = list[0].id;
        opened(
            &mut list,
            shown(SpaceId::new(), "terminal.terminal", 1),
            None,
        );
        assert_eq!(layout(&list), [vec![vec![1]], vec![]]);
        assert_eq!(list[0].id, bottom);
    }

    #[test]
    fn a_pane_shown_already_is_named_and_nothing_changes() {
        let mut list = start();
        let work = SpaceId::new();
        let first = opened(&mut list, shown(work, "terminal.terminal", 1), None);
        let before = list.clone();
        assert_eq!(
            opened(&mut list, shown(work, "terminal.terminal", 1), None),
            first
        );
        assert_eq!(list, before);
        // Another Space's is another Pane.
        opened(
            &mut list,
            shown(SpaceId::new(), "terminal.terminal", 1),
            None,
        );
        assert_eq!(layout(&list), [vec![vec![1]], vec![vec![1]], vec![]]);
    }

    #[test]
    fn with_no_place_a_pane_joins_the_workspace_of_its_space() {
        let mut list = start();
        let (work, home) = (SpaceId::new(), SpaceId::new());
        opened(&mut list, shown(work, "a.a", 1), None);
        opened(&mut list, shown(home, "a.a", 2), None);
        opened(&mut list, shown(work, "a.a", 3), None);
        assert_eq!(
            layout(&list),
            [vec![vec![1], vec![3]], vec![vec![2]], vec![]]
        );
    }

    #[test]
    fn a_pane_opens_beside_another_or_instead_of_it() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        opened(&mut list, shown(work, "a.a", 2), beside(one, Side::Right));
        opened(&mut list, shown(work, "a.a", 3), beside(one, Side::Left));
        opened(&mut list, shown(work, "a.a", 4), beside(one, Side::Below));
        opened(&mut list, shown(work, "a.a", 5), beside(one, Side::Above));
        assert_eq!(
            layout(&list),
            [vec![vec![3], vec![5, 1, 4], vec![2]], vec![]]
        );
        open(
            &mut list,
            shown(work, "a.a", 6),
            None,
            Some(one),
            None,
            false,
            None,
        )
        .unwrap();
        assert_eq!(
            layout(&list),
            [vec![vec![3], vec![5, 6, 4], vec![2]], vec![]]
        );
        let both = open(
            &mut list,
            shown(work, "a.a", 7),
            beside(one, Side::Left),
            Some(one),
            None,
            false,
            None,
        );
        assert!(both.is_err());
    }

    #[test]
    fn a_pane_shown_already_is_named_unless_it_opens_again() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        assert_eq!(opened(&mut list, shown(work, "a.a", 1), None), one);
        let two = open(
            &mut list,
            shown(work, "a.a", 1),
            None,
            None,
            None,
            true,
            None,
        )
        .unwrap();
        assert_ne!(two, one);
        assert_eq!(layout(&list), [vec![vec![1], vec![1]], vec![]]);
    }

    #[test]
    fn a_new_column_takes_its_width_and_a_bad_pane_is_refused() {
        let mut list = start();
        let work = SpaceId::new();
        open(
            &mut list,
            shown(work, "a.a", 1),
            None,
            None,
            Some("1/3".into()),
            false,
            None,
        )
        .unwrap();
        assert_eq!(list[0].columns[0].width.as_deref(), Some("1/3"));
        for bad in ["0", "3/2", "half", "1/0"] {
            let refused = open(
                &mut list,
                shown(work, "a.a", 2),
                None,
                None,
                Some(bad.into()),
                false,
                None,
            );
            assert!(refused.is_err(), "{bad}");
        }
        assert!(
            open(
                &mut list,
                shown(work, "a", 2),
                None,
                None,
                None,
                false,
                None
            )
            .is_err()
        );
        let listed = Shown {
            args: json!([1]),
            ..shown(work, "a.a", 2)
        };
        assert!(open(&mut list, listed, None, None, None, false, None).is_err());
    }

    #[test]
    fn closing_the_last_pane_takes_its_column_and_tidying_its_workspace() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        let two = opened(&mut list, shown(work, "a.a", 2), beside(one, Side::Right));
        close(&mut list, one).unwrap();
        assert_eq!(layout(&list), [vec![vec![2]], vec![]]);
        close(&mut list, two).unwrap();
        // It stays while the Person looks at it; only the window knows.
        assert_eq!(layout(&list), [EMPTY, EMPTY]);
        let looked_at = list[0].id;
        tidy(&mut list, Some(looked_at));
        assert_eq!(list.len(), 2);
        tidy(&mut list, None);
        assert_eq!(layout(&list), [EMPTY]);
        // The last stays.
        tidy(&mut list, None);
        assert_eq!(list.len(), 1);
        assert!(close(&mut list, two).is_err());
    }

    #[test]
    fn a_pane_alone_moves_with_its_column_and_one_in_a_stack_alone() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        let two = opened(&mut list, shown(work, "a.a", 2), beside(one, Side::Right));
        let three = opened(&mut list, shown(work, "a.a", 3), beside(two, Side::Below));
        let first = list[0].columns[0].id;
        size(&mut list, first, Some("1/3".into())).unwrap();
        // Alone: the column goes along, with its width.
        move_pane(&mut list, one, &beside(three, Side::Right).unwrap(), None).unwrap();
        assert_eq!(layout(&list), [vec![vec![2, 3], vec![1]], vec![]]);
        assert_eq!(list[0].columns[1].id, first);
        assert_eq!(list[0].columns[1].width.as_deref(), Some("1/3"));
        // In a stack: it leaves its column for one of its own.
        let workspace = list[0].id;
        move_pane(
            &mut list,
            three,
            &Place::Column {
                workspace,
                index: 0,
            },
            None,
        )
        .unwrap();
        assert_eq!(layout(&list), [vec![vec![3], vec![2], vec![1]], vec![]]);
        // Into a column's stack, at an index.
        let column = list[0].columns[1].id;
        move_pane(&mut list, one, &Place::Stack { column, index: 0 }, None).unwrap();
        assert_eq!(layout(&list), [vec![vec![3], vec![1, 2]], vec![]]);
        // Down its own stack: counted as if it had left.
        move_pane(&mut list, one, &Place::Stack { column, index: 1 }, None).unwrap();
        assert_eq!(layout(&list), [vec![vec![3], vec![2, 1]], vec![]]);
        // Alone, into its own column: it stays.
        let alone = list[0].columns[0].id;
        move_pane(
            &mut list,
            three,
            &Place::Stack {
                column: alone,
                index: 5,
            },
            None,
        )
        .unwrap();
        assert_eq!(layout(&list), [vec![vec![3], vec![2, 1]], vec![]]);
        assert!(move_pane(&mut list, one, &beside(one, Side::Right).unwrap(), None).is_err());
    }

    #[test]
    fn a_pane_sent_to_the_bottom_workspace_brings_a_new_empty_one() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        opened(&mut list, shown(work, "a.a", 2), beside(one, Side::Right));
        let bottom = Place::Column {
            workspace: list[1].id,
            index: usize::MAX,
        };
        move_pane(&mut list, one, &bottom, None).unwrap();
        assert_eq!(layout(&list), [vec![vec![2]], vec![vec![1]], vec![]]);
    }

    #[test]
    fn a_pane_dropped_between_workspaces_makes_one_there() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        let two = opened(&mut list, shown(work, "a.a", 2), beside(one, Side::Right));
        let three = opened(&mut list, shown(work, "a.a", 3), beside(two, Side::Below));
        let first = list[0].columns[0].id;
        size(&mut list, first, Some("1/3".into())).unwrap();
        // Alone: its column goes along, with its width.
        move_pane(&mut list, one, &Place::Workspace { index: 0 }, None).unwrap();
        assert_eq!(layout(&list), [vec![vec![1]], vec![vec![2, 3]], vec![]]);
        assert_eq!(list[0].columns[0].width.as_deref(), Some("1/3"));
        // From a stack, between two.
        move_pane(&mut list, three, &Place::Workspace { index: 1 }, None).unwrap();
        assert_eq!(
            layout(&list),
            [vec![vec![1]], vec![vec![3]], vec![vec![2]], vec![]]
        );
        // Past the last: over the empty one at the bottom, which stays.
        move_pane(&mut list, one, &Place::Workspace { index: 9 }, None).unwrap();
        assert_eq!(
            layout(&list),
            [EMPTY, vec![vec![3]], vec![vec![2]], vec![vec![1]], vec![]]
        );
    }

    #[test]
    fn a_column_moves_whole_counted_as_if_it_had_left() {
        let mut list = start();
        let work = SpaceId::new();
        let one = opened(&mut list, shown(work, "a.a", 1), None);
        opened(&mut list, shown(work, "a.a", 2), beside(one, Side::Right));
        opened(&mut list, shown(work, "a.a", 3), beside(one, Side::Below));
        let (first, workspace) = (list[0].columns[0].id, list[0].id);
        move_column(&mut list, first, workspace, 1).unwrap();
        assert_eq!(layout(&list), [vec![vec![2], vec![1, 3]], vec![]]);
        let bottom = list[1].id;
        move_column(&mut list, first, bottom, 0).unwrap();
        assert_eq!(layout(&list), [vec![vec![2]], vec![vec![1, 3]], vec![]]);
    }

    #[test]
    fn a_workspace_moves_whole_but_never_under_the_empty_one() {
        let mut list = start();
        for n in 1..=3 {
            opened(&mut list, shown(SpaceId::new(), "agents.thread", n), None);
        }
        let ids: Vec<WorkspaceId> = list.iter().map(|w| w.id).collect();

        move_workspace(&mut list, ids[2], 0).unwrap();
        assert_eq!(
            layout(&list),
            [vec![vec![3]], vec![vec![1]], vec![vec![2]], vec![]]
        );
        // Past the last, the last above the empty one.
        move_workspace(&mut list, ids[2], 9).unwrap();
        assert_eq!(
            layout(&list),
            [vec![vec![1]], vec![vec![2]], vec![vec![3]], vec![]]
        );
        assert_eq!(list.last().map(|w| w.id), Some(ids[3]));

        let refused = move_workspace(&mut list, ids[3], 0).unwrap_err();
        assert!(refused.message.contains("stays there"), "{refused:?}");
        assert!(move_workspace(&mut list, WorkspaceId::new(), 0).is_err());
    }

    /// Each workspace's columns by their Group, numbered as they first
    /// stand, from 1; 0 for none.
    fn grouping(list: &Arrangement) -> Vec<Vec<usize>> {
        let mut seen: Vec<GroupId> = Vec::new();
        list.iter()
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

    /// One workspace of `n` columns, a Pane each, numbered from 1.
    fn row(n: u32) -> (Arrangement, Vec<ColumnId>) {
        let mut list = start();
        let work = SpaceId::new();
        for i in 1..=n {
            opened(&mut list, shown(work, "a.a", i), None);
        }
        let ids = list[0].columns.iter().map(|c| c.id).collect();
        (list, ids)
    }

    #[test]
    fn a_group_starts_alone_then_columns_join_it_and_leave_it_either_way() {
        let (mut list, c) = row(4);
        group(&mut list, c[1]).unwrap();
        // Again, it stays in the one it is in.
        group(&mut list, c[1]).unwrap();
        assert_eq!(grouping(&list)[0], [0, 1, 0, 0]);
        regroup(&mut list, c[2], Toward::Left).unwrap();
        regroup(&mut list, c[0], Toward::Right).unwrap();
        assert_eq!(grouping(&list)[0], [1, 1, 1, 0]);
        // No Group beside it that way.
        assert!(regroup(&mut list, c[3], Toward::Right).is_err());
        // From the middle, it leaves past its Group's columns that way.
        regroup(&mut list, c[1], Toward::Right).unwrap();
        assert_eq!(layout(&list)[0], [[1], [3], [2], [4]]);
        assert_eq!(grouping(&list)[0], [1, 1, 0, 0]);
        regroup(&mut list, c[0], Toward::Left).unwrap();
        regroup(&mut list, c[2], Toward::Left).unwrap();
        assert_eq!(grouping(&list)[0], [0, 0, 0, 0]);
    }

    #[test]
    fn a_group_moves_whole_and_never_into_another() {
        let (mut list, c) = row(5);
        let here = list[0].id;
        group(&mut list, c[0]).unwrap();
        regroup(&mut list, c[1], Toward::Left).unwrap();
        group(&mut list, c[3]).unwrap();
        regroup(&mut list, c[4], Toward::Left).unwrap();
        // Past the column after it.
        move_group(&mut list, c[1], here, 1).unwrap();
        assert_eq!(layout(&list)[0], [[3], [1], [2], [4], [5]]);
        // Into the other Group's middle is past it.
        move_group(&mut list, c[0], here, 2).unwrap();
        assert_eq!(layout(&list)[0], [[3], [4], [5], [1], [2]]);
        assert_eq!(grouping(&list)[0], [0, 1, 1, 2, 2]);
        // To another workspace, all of it.
        let below = list[1].id;
        move_group(&mut list, c[4], below, 0).unwrap();
        assert_eq!(
            layout(&list),
            [
                vec![vec![3], vec![1], vec![2]],
                vec![vec![4], vec![5]],
                EMPTY
            ]
        );
    }

    #[test]
    fn a_column_put_inside_a_group_joins_it_and_one_moved_away_leaves() {
        let (mut list, c) = row(4);
        let here = list[0].id;
        group(&mut list, c[0]).unwrap();
        regroup(&mut list, c[1], Toward::Left).unwrap();
        regroup(&mut list, c[2], Toward::Left).unwrap();
        // Moved inside, it stays; moved past the Group's edge, it leaves.
        move_column(&mut list, c[2], here, 0).unwrap();
        assert_eq!(grouping(&list)[0], [1, 1, 1, 0]);
        move_column(&mut list, c[0], here, 3).unwrap();
        assert_eq!(layout(&list)[0], [[3], [2], [4], [1]]);
        assert_eq!(grouping(&list)[0], [1, 1, 0, 0]);
        // Between two of a Group's columns, a new one joins it.
        let first = list[0].columns[0].panes[0].id;
        opened(
            &mut list,
            shown(SpaceId::new(), "a.a", 9),
            beside(first, Side::Right),
        );
        assert_eq!(grouping(&list)[0], [1, 1, 1, 0, 0]);
        // A Pane taken out of a Group's column, beside it, stays in it.
        let second = list[0].columns[1].panes[0].id;
        let joined = opened(
            &mut list,
            shown(SpaceId::new(), "a.a", 8),
            beside(second, Side::Below),
        );
        move_pane(
            &mut list,
            joined,
            &Place::Column {
                workspace: here,
                index: 2,
            },
            None,
        )
        .unwrap();
        assert_eq!(grouping(&list)[0], [1, 1, 1, 1, 0, 0]);
        // A Group alone keeps a column that moves on its own.
        let (mut list, c) = row(2);
        let here = list[0].id;
        group(&mut list, c[0]).unwrap();
        move_column(&mut list, c[0], here, 1).unwrap();
        assert_eq!(grouping(&list)[0], [0, 1]);
    }

    #[test]
    fn at_a_groups_end_the_mouse_says_inside_it_or_out() {
        let (mut list, c) = row(4);
        group(&mut list, c[0]).unwrap();
        regroup(&mut list, c[1], Toward::Left).unwrap();
        let pane = |list: &Arrangement, n: usize| list[0].columns[n].panes[0].id;
        let (last, lone) = (pane(&list, 1), pane(&list, 3));
        let right = Place::Beside {
            pane: last,
            side: Side::Right,
        };
        move_pane(&mut list, lone, &right, None).unwrap();
        assert_eq!(grouping(&list)[0], [1, 1, 0, 0]);
        move_pane(&mut list, lone, &right, Some(true)).unwrap();
        assert_eq!(grouping(&list)[0], [1, 1, 1, 0]);
        move_pane(&mut list, lone, &right, Some(false)).unwrap();
        assert_eq!(grouping(&list)[0], [1, 1, 0, 0]);
        // Between two of its columns, it is in the Group whatever it says.
        let first = pane(&list, 0);
        let between = Place::Beside {
            pane: first,
            side: Side::Right,
        };
        move_pane(&mut list, lone, &between, Some(false)).unwrap();
        assert_eq!(grouping(&list)[0], [1, 1, 1, 0]);
    }

    #[test]
    fn a_spaces_threads_open_in_a_row_on_its_own_workspace() {
        let mut list = start();
        let (work, home) = (SpaceId::new(), SpaceId::new());
        let on = |space| Some(Place::Space { space });
        opened(&mut list, shown(work, "agents.thread", 1), on(work));
        opened(&mut list, shown(home, "agents.thread", 2), on(home));
        opened(&mut list, shown(work, "agents.thread", 3), on(work));
        assert_eq!(
            layout(&list),
            [vec![vec![1], vec![3]], vec![vec![2]], EMPTY]
        );
        assert_eq!(
            list.iter().map(|w| w.space).collect::<Vec<_>>(),
            [Some(work), Some(home), None]
        );
        // A Space with none takes the top one that shows its Panes.
        let mut other = start();
        opened(&mut other, shown(work, "a.a", 7), None);
        opened(&mut other, shown(work, "agents.thread", 8), on(work));
        assert_eq!(layout(&other), [vec![vec![7], vec![8]], EMPTY]);
        assert_eq!(other[0].space, Some(work));
        // Emptied, it is no Space's place: the Space takes the empty one.
        let two = list[1].columns[0].panes[0].id;
        close(&mut list, two).unwrap();
        tidy(&mut list, None);
        opened(&mut list, shown(home, "agents.thread", 4), on(home));
        assert_eq!(
            layout(&list),
            [vec![vec![1], vec![3]], vec![vec![4]], EMPTY]
        );
    }

    #[test]
    fn what_a_thread_opens_goes_into_its_group_as_a_deck() {
        let mut list = start();
        let work = SpaceId::new();
        let thread = opened(&mut list, shown(work, "agents.thread", 1), None);
        opened(&mut list, shown(work, "a.a", 2), None);
        let group = Place::Group { pane: thread };
        let diff = opened(&mut list, shown(work, "git.diff", 3), Some(group.clone()));
        // The Thread's column starts a Group, and a Deck right of it.
        assert_eq!(layout(&list)[0], [vec![1], vec![3], vec![2]]);
        assert_eq!(grouping(&list)[0], [1, 1, 0]);
        assert_eq!(list[0].columns[1].display, Some(Display::Deck));
        // The next goes into that Deck; one shown already stays; and a
        // Pane moved there joins it too.
        opened(
            &mut list,
            shown(work, "browser.browser", 4),
            Some(group.clone()),
        );
        assert_eq!(layout(&list)[0], [vec![1], vec![3, 4], vec![2]]);
        assert_eq!(
            opened(&mut list, shown(work, "git.diff", 3), Some(group.clone())),
            diff
        );
        let lone = list[0].columns[2].panes[0].id;
        move_pane(&mut list, lone, &group, None).unwrap();
        assert_eq!(layout(&list)[0], [vec![1], vec![3, 4, 2]]);
    }

    #[test]
    fn a_group_fills_the_screen_until_a_width_is_given() {
        let (mut list, c) = row(3);
        assert!(fill(&mut list, c[0], true).is_err());
        group(&mut list, c[0]).unwrap();
        regroup(&mut list, c[1], Toward::Left).unwrap();
        fill(&mut list, c[1], true).unwrap();
        let group = list[0].columns[0].group;
        assert_eq!(list[0].filled, group);
        // It goes with the Group to another workspace.
        let below = list[1].id;
        move_group(&mut list, c[0], below, 0).unwrap();
        assert_eq!((list[0].filled, list[1].filled), (None, group));
        // A width given ends it.
        size(&mut list, c[0], Some("1/3".into())).unwrap();
        assert_eq!(list[1].filled, None);
    }

    #[test]
    fn a_group_split_apart_keeps_only_its_first_run() {
        let (mut list, _) = row(3);
        let g = GroupId::new();
        for column in &mut list[0].columns {
            column.group = Some(g);
        }
        list[0].columns[1].group = None;
        normalize(&mut list);
        assert_eq!(grouping(&list)[0], [1, 0, 0]);
    }

    #[test]
    fn size_maximize_and_display_keep_what_was_decided() {
        let mut list = start();
        opened(&mut list, shown(SpaceId::new(), "a.a", 1), None);
        let column = list[0].columns[0].id;
        size(&mut list, column, Some("2/3".into())).unwrap();
        maximize(&mut list, column, true).unwrap();
        display(&mut list, column, Some(Display::Deck)).unwrap();
        let kept = &list[0].columns[0];
        assert_eq!(
            (kept.width.as_deref(), kept.full, kept.display),
            (Some("2/3"), true, Some(Display::Deck))
        );
        // A width given ends the whole screen, as niri's.
        size(&mut list, column, None).unwrap();
        assert_eq!(
            (list[0].columns[0].width.as_deref(), list[0].columns[0].full),
            (None, false)
        );
        assert!(size(&mut list, column, Some("2".into())).is_err());
    }

    #[test]
    fn a_wall_shows_its_space_whole_and_the_others_only_when_let() {
        let mut list = start();
        let (mine, other) = (SpaceId::new(), SpaceId::new());
        let a = opened(&mut list, shown(mine, "a.a", 1), None);
        let b = opened(&mut list, shown(other, "a.a", 2), None);
        let walled = Wall {
            space: mine,
            sees_others: false,
        };
        let let_see = Wall {
            sees_others: true,
            ..walled
        };
        let pane = |id| panes(&list).find(|p| p.id == id).unwrap();
        assert_eq!(sight(None, pane(b)), Sight::Whole);
        assert_eq!(sight(Some(walled), pane(a)), Sight::Whole);
        assert_eq!(sight(Some(walled), pane(b)), Sight::Hidden);
        assert_eq!(sight(Some(let_see), pane(b)), Sight::Outline);
        assert!(seen(&list, walled, b).is_err());
        assert!(seen(&list, let_see, b).is_ok());
        let agent = AgentId::new();
        let c = open(
            &mut list,
            shown(mine, "a.a", 3),
            None,
            None,
            None,
            false,
            Some(agent),
        );
        assert_eq!(seen(&list, walled, c.unwrap()).unwrap().by, Some(agent));
    }

    #[test]
    fn update_keeps_new_args_in_place() {
        let mut list = start();
        let one = opened(&mut list, shown(SpaceId::new(), "a.a", 1), None);
        update(&mut list, one, json!({ "n": 7 })).unwrap();
        assert_eq!(layout(&list), [vec![vec![7]], vec![]]);
        assert_eq!(args_of(&list, one), Some(&json!({ "n": 7 })));
        assert!(update(&mut list, one, json!(null)).is_err());
    }

    #[test]
    fn a_windows_arrangement_goes_over_the_engines_with_each_pane_once() {
        let work = SpaceId::new();
        let pane = |n: u32| Pane {
            id: PaneId::new(),
            shows: shown(work, "a.a", n),
            by: None,
            height: None,
        };
        let column = |panes| Column {
            id: ColumnId::new(),
            panes,
            width: Some("1/2".into()),
            full: false,
            display: None,
            group: None,
        };
        let workspace = |columns| Workspace {
            id: WorkspaceId::new(),
            columns,
            filled: None,
            space: None,
        };
        let window = vec![
            workspace(vec![column(vec![pane(1), pane(2)])]),
            workspace(vec![column(vec![pane(1)])]),
            workspace(vec![]),
        ];
        let mut list = start();
        opened(&mut list, shown(work, "a.a", 2), None);
        opened(&mut list, shown(work, "a.a", 3), None);
        take(&mut list, window.clone()).unwrap();
        // The second showings go, their columns with them, and of the
        // empty workspaces only the last stays.
        assert_eq!(layout(&list), [vec![vec![1, 2]], vec![vec![3]], vec![]]);
        assert_eq!(list[0].id, window[0].id);

        let mut list = start();
        let mut same = vec![workspace(vec![
            column(vec![pane(1)]),
            column(vec![pane(2)]),
        ])];
        same[0].columns[1].id = same[0].columns[0].id;
        assert!(take(&mut list, same).is_err());
    }
}
