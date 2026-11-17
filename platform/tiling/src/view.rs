//! What a device looks at, and what a change to the arrangement does to
//! it (ADR 0135, decisions 7 and 9; laws 1, 2 and 7). The view is each
//! device's own (ADR 0025, decision 1): the workspace on screen, each
//! workspace's focused column and each column's shown Pane. The engine
//! keeps none of it and does not know the device in front; the rule is
//! here, one pure function, and each client runs it on its own view.
//!
//! [`look`] reads the view over an arrangement:
//!
//! - **The Person's eyes** (law 2). The focus and the screen go where the
//!   Person's act aims them (`aim`: a Pane they opened, moved or asked
//!   for again, law 7), and nowhere else. What an Agent or another device
//!   changes moves neither (law 1): what the view names stays in focus
//!   wherever it stands now.
//! - **After a close** (decision 7). When the Pane in focus on a workspace
//!   is there no more, the focus goes back to the Pane that had it before,
//!   while that one still stands on the workspace. Else, in a stack, to
//!   the Pane that takes its place; else to the column on the left.
//! - **The screen** stays on its workspace; one that goes leaves it on
//!   the one that takes its place.
//!
//! It reads the arrangement by its IDs alone, as text ([`Shape`]), so it
//! asks nothing of what a Pane shows, and a client hands it no more.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// The arrangement as the view reads it: each workspace's columns and
/// each column's Panes, by their IDs.
#[derive(Clone, Debug, Default, Deserialize, TS)]
#[serde(transparent)]
#[ts(export, export_to = "workspaces/")]
pub struct Shape(pub Vec<ShapeWorkspace>);

#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct ShapeWorkspace {
    pub id: String,
    pub columns: Vec<ShapeColumn>,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct ShapeColumn {
    pub id: String,
    pub panes: Vec<ShapePane>,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct ShapePane {
    pub id: String,
}

/// An ID and where it stood, so a neighbour takes its place when it goes.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct Held {
    pub id: String,
    pub at: usize,
}

/// What the Person looks at on one device.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct View {
    /// The workspace on screen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub current: Option<Held>,
    /// Each workspace's focused column, by the workspace's ID.
    #[serde(default)]
    pub focus: BTreeMap<String, Held>,
    /// Each column's shown Pane, by the column's ID.
    #[serde(default)]
    pub active: BTreeMap<String, Held>,
    /// The Panes that had the focus on each workspace, by its ID, the
    /// last one last and each once: where the focus goes back to after a
    /// close.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    #[ts(as = "Option<BTreeMap<String, Vec<String>>>", optional)]
    pub trail: BTreeMap<String, Vec<String>>,
}

/// How many Panes a workspace's trail remembers.
const TRAIL: usize = 16;

/// `view` over the arrangement `shape` as it stands now, with the
/// Person's act aimed at the Pane `aim`, if they did one that aims: the
/// view to draw, each ID with the place it has now, and to look by next.
/// What it names nothing for is the first: a workspace's first column, a
/// column's first Pane.
pub fn look(shape: &Shape, view: &View, aim: Option<&str>) -> View {
    let aimed = aim.and_then(|pane| {
        let found = |(w, workspace)| place_in(workspace, pane).map(|(c, p)| (w, c, p));
        shape.0.iter().enumerate().find_map(found)
    });
    let current = match aimed {
        Some((w, ..)) => w,
        None => stays(view.current.as_ref(), shape.0.len(), |w| &shape.0[w].id),
    };
    let mut next = View::default();
    for (w, workspace) in shape.0.iter().enumerate() {
        let columns = &workspace.columns;
        let mut active: Vec<usize> = columns
            .iter()
            .map(|column| {
                let shown = view.active.get(&column.id);
                stays(shown, column.panes.len(), |p| &column.panes[p].id)
            })
            .collect();
        let focus = match aimed {
            Some((at, c, p)) if at == w => {
                active[c] = p;
                c
            }
            _ => focus_of(workspace, view, &mut active),
        };
        let held = |id: &String, at| Held { id: id.clone(), at };
        if let Some(column) = columns.get(focus) {
            next.focus
                .insert(workspace.id.clone(), held(&column.id, focus));
        }
        for (column, &at) in columns.iter().zip(&active) {
            if let Some(pane) = column.panes.get(at) {
                next.active.insert(column.id.clone(), held(&pane.id, at));
            }
        }
        let focused = (columns.get(focus))
            .and_then(|column| column.panes.get(active[focus]))
            .filter(|_| w == current);
        let trail = trail_of(workspace, view, focused.map(|pane| pane.id.as_str()));
        if !trail.is_empty() {
            next.trail.insert(workspace.id.clone(), trail);
        }
    }
    next.current = (shape.0.get(current)).map(|workspace| Held {
        id: workspace.id.clone(),
        at: current,
    });
    next
}

/// The workspace's focused column where no act aims: where the Pane in
/// focus stands on the workspace now; else as after a close (decision 7).
/// `active` takes the Pane the focus is on.
fn focus_of(workspace: &ShapeWorkspace, view: &View, active: &mut [usize]) -> usize {
    let columns = &workspace.columns;
    let Some(was) = view.focus.get(&workspace.id) else {
        return 0;
    };
    let column = columns.iter().position(|column| column.id == was.id);
    // With its column gone, the column on the left.
    let left = || {
        was.at
            .saturating_sub(1)
            .min(columns.len().saturating_sub(1))
    };
    let Some(pane) = view.active.get(&was.id).map(|pane| pane.id.as_str()) else {
        // The view names no Pane there: the column, or what took its place.
        return column.unwrap_or_else(left);
    };
    // The Pane in focus still stands here, in its column or another; else
    // the focus goes back to the last Pane that had it before and stands.
    let trail = view.trail.get(&workspace.id).into_iter().flatten().rev();
    let before = trail.filter(|one| one.as_str() != pane);
    let stands = (place_in(workspace, pane)).or_else(|| {
        before
            .map(String::as_str)
            .find_map(|one| place_in(workspace, one))
    });
    if let Some((c, p)) = stands {
        active[c] = p;
        return c;
    }
    // In a stack, the Pane that takes its place, as `active` has it.
    column.unwrap_or_else(left)
}

/// The workspace's trail after this look: what the view had, of the Panes
/// that still stand here, with the Pane `focused` now last. The Pane in
/// focus is one the Person looks at, on the workspace on screen: a
/// workspace they never came to has no trail.
fn trail_of(workspace: &ShapeWorkspace, view: &View, focused: Option<&str>) -> Vec<String> {
    let mut trail: Vec<String> = (view.trail.get(&workspace.id).into_iter().flatten())
        .filter(|pane| Some(pane.as_str()) != focused && place_in(workspace, pane).is_some())
        .cloned()
        .collect();
    trail.extend(focused.map(str::to_owned));
    let over = trail.len().saturating_sub(TRAIL);
    trail.split_off(over)
}

/// Where a held ID stands among `len` things, each named by `id`: where
/// it is now; gone, the place it had, which the one after it took; none
/// held, the first.
fn stays<'a>(held: Option<&Held>, len: usize, id: impl Fn(usize) -> &'a String) -> usize {
    let Some(held) = held else { return 0 };
    (0..len)
        .find(|&at| *id(at) == held.id)
        .unwrap_or_else(|| held.at.min(len.saturating_sub(1)))
}

/// Where Pane `pane` stands on `workspace`: its column, and its place in
/// the column.
fn place_in(workspace: &ShapeWorkspace, pane: &str) -> Option<(usize, usize)> {
    workspace
        .columns
        .iter()
        .enumerate()
        .find_map(|(c, column)| {
            let p = column.panes.iter().position(|one| one.id == pane)?;
            Some((c, p))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A workspace `id` of columns, each of its Panes' IDs. A column is
    /// named by its first Pane, so it is the same one in the arrangement
    /// before and after.
    fn workspace(id: &str, columns: &[&[&str]]) -> ShapeWorkspace {
        let columns = columns.iter().map(|panes| ShapeColumn {
            id: format!("column of {}", panes[0]),
            panes: (panes.iter())
                .map(|pane| ShapePane {
                    id: (*pane).to_owned(),
                })
                .collect(),
        });
        ShapeWorkspace {
            id: id.to_owned(),
            columns: columns.collect(),
        }
    }

    /// One workspace, `w`.
    fn one(columns: &[&[&str]]) -> Shape {
        Shape(vec![workspace("w", columns)])
    }

    /// The Pane in focus on the workspace on screen.
    fn focused(view: &View) -> &str {
        let workspace = &view.current.as_ref().unwrap().id;
        &view.active[&view.focus[workspace].id].id
    }

    /// The view after the Person aims at each of `panes` in turn.
    fn after(shape: &Shape, panes: &[&str]) -> View {
        panes
            .iter()
            .fold(View::default(), |view, pane| look(shape, &view, Some(pane)))
    }

    #[test]
    fn with_no_view_the_first_of_each_is_looked_at() {
        let shape = one(&[&["a", "b"], &["c"]]);
        let looked = look(&shape, &View::default(), None);
        assert_eq!(looked.current.as_ref().map(|held| held.at), Some(0));
        assert_eq!(looked.focus["w"].at, 0);
        assert_eq!(focused(&looked), "a");
    }

    #[test]
    fn the_persons_act_aims_the_focus_and_the_screen() {
        let shape = Shape(vec![
            workspace("w", &[&["a"]]),
            workspace("v", &[&["b"], &["c", "d"]]),
        ]);
        let looked = look(&shape, &View::default(), Some("d"));
        assert_eq!(focused(&looked), "d");
        assert_eq!(looked.current.as_ref().map(|held| held.at), Some(1));
        // Law 7: a Pane shown already is only aimed at again.
        let again = look(&shape, &looked, Some("a"));
        assert_eq!(focused(&again), "a");
        // A Pane the arrangement does not show yet aims at nothing.
        let gone = look(&shape, &again, Some("z"));
        assert_eq!(focused(&gone), "a");
    }

    #[test]
    fn what_another_changes_moves_neither_the_focus_nor_the_screen() {
        // Laws 1 and 2: an Agent opens a Pane left of the one in focus,
        // and a workspace above the one on screen.
        let before = Shape(vec![workspace("w", &[&["a"], &["b"]])]);
        let view = after(&before, &["b"]);
        let now = Shape(vec![
            workspace("new", &[&["x"]]),
            workspace("w", &[&["agents"], &["a"], &["b", "more"]]),
        ]);
        let looked = look(&now, &view, None);
        assert_eq!(looked.current.as_ref().map(|held| held.at), Some(1));
        assert_eq!(focused(&looked), "b");
    }

    #[test]
    fn after_a_close_the_focus_goes_back_to_the_pane_that_had_it_before() {
        // Decision 7: the Person looked at a, then c, then b.
        let before = one(&[&["a"], &["b"], &["c"]]);
        let view = after(&before, &["a", "c", "b"]);
        assert_eq!(view.trail["w"], ["a", "c", "b"]);
        // b closes: back to c, on its right, not to the column on the left.
        let closed = one(&[&["a"], &["c"]]);
        let looked = look(&closed, &view, None);
        assert_eq!(focused(&looked), "c");
        // c closes too: back to a.
        let last = one(&[&["a"]]);
        assert_eq!(focused(&look(&last, &looked, None)), "a");
    }

    #[test]
    fn it_goes_back_only_to_a_pane_that_still_stands_on_the_workspace() {
        let before = Shape(vec![
            workspace("w", &[&["a"], &["b"], &["c"]]),
            workspace("v", &[]),
        ]);
        let view = after(&before, &["a", "c"]);
        // a moved to another workspace, and c closed: the column on the
        // left of where c stood.
        let now = Shape(vec![workspace("w", &[&["b"]]), workspace("v", &[&["a"]])]);
        let looked = look(&now, &view, None);
        assert_eq!(looked.current.as_ref().map(|held| held.at), Some(0));
        assert_eq!(focused(&looked), "b");
    }

    #[test]
    fn in_a_stack_with_none_before_the_pane_that_takes_its_place() {
        let before = one(&[&["a", "b", "c"]]);
        let view = after(&before, &["b"]);
        let closed = one(&[&["a", "c"]]);
        assert_eq!(focused(&look(&closed, &view, None)), "c");
        // With one before it, back to that one, in the stack or not.
        let view = after(&before, &["a", "b"]);
        assert_eq!(focused(&look(&closed, &view, None)), "a");
    }

    #[test]
    fn with_none_before_and_its_column_gone_the_column_on_the_left() {
        let before = one(&[&["a"], &["b"], &["c"]]);
        let view = after(&before, &["c"]);
        let closed = one(&[&["a"], &["b"]]);
        assert_eq!(focused(&look(&closed, &view, None)), "b");
        // The first column gone: the one that takes its place.
        let view = after(&before, &["a"]);
        let closed = one(&[&["b"], &["c"]]);
        assert_eq!(focused(&look(&closed, &view, None)), "b");
    }

    #[test]
    fn a_pane_in_focus_whose_column_went_keeps_the_focus_where_it_stands() {
        // Its column joined the one on its left, by another's hand.
        let before = one(&[&["a"], &["b"]]);
        let view = after(&before, &["b"]);
        let joined = one(&[&["a", "b"]]);
        assert_eq!(focused(&look(&joined, &view, None)), "b");
    }

    #[test]
    fn a_workspace_that_goes_leaves_the_screen_on_the_one_that_takes_its_place() {
        let before = Shape(vec![
            workspace("w", &[&["a"]]),
            workspace("v", &[&["b"]]),
            workspace("u", &[&["c"]]),
        ]);
        let view = after(&before, &["b"]);
        let now = Shape(vec![workspace("w", &[&["a"]]), workspace("u", &[&["c"]])]);
        let looked = look(&now, &view, None);
        assert_eq!(focused(&looked), "c");
        // The last one gone: the last that is left.
        let view = after(&before, &["c"]);
        let now = Shape(vec![workspace("w", &[&["a"]]), workspace("v", &[&["b"]])]);
        assert_eq!(focused(&look(&now, &view, None)), "b");
    }

    #[test]
    fn the_trail_keeps_each_pane_once_and_forgets_what_left() {
        let shape = one(&[&["a"], &["b"], &["c"]]);
        let view = after(&shape, &["a", "b", "a", "c", "a"]);
        assert_eq!(view.trail["w"], ["b", "c", "a"]);
        let less = one(&[&["a"], &["c"]]);
        assert_eq!(look(&less, &view, None).trail["w"], ["c", "a"]);
        let many: Vec<String> = (0..TRAIL + 4).map(|n| format!("p{n}")).collect();
        let panes: Vec<&str> = many.iter().map(String::as_str).collect();
        let columns: Vec<&[&str]> = panes.chunks(1).collect();
        let wide = one(&columns);
        assert_eq!(after(&wide, &panes).trail["w"].len(), TRAIL);
    }

    #[test]
    fn the_pane_in_focus_keeps_it_in_whatever_column_it_stands_now() {
        // Another's hand took b out of the stack it shared with a.
        let before = one(&[&["a", "b"]]);
        let view = after(&before, &["b"]);
        let apart = one(&[&["a"], &["b"]]);
        assert_eq!(focused(&look(&apart, &view, None)), "b");
    }

    #[test]
    fn a_workspace_the_person_never_came_to_has_no_trail() {
        let shape = Shape(vec![
            workspace("w", &[&["a"]]),
            workspace("v", &[&["p"], &["q"], &["r"]]),
        ]);
        let view = after(&shape, &["a"]);
        assert_eq!(view.trail.get("v"), None);
        // They go there, to r, and close it: the column on its left, not p,
        // which was only first.
        let view = look(&shape, &view, Some("r"));
        assert_eq!(view.trail["v"], ["r"]);
        let closed = Shape(vec![
            workspace("w", &[&["a"]]),
            workspace("v", &[&["p"], &["q"]]),
        ]);
        assert_eq!(focused(&look(&closed, &view, None)), "q");
    }
}
