//! Where a Pane goes when no one named a place: the Tiling's placement
//! policy (ADR 0110). It only decides, from the arrangement and the facts
//! it is given; `model` does what it decides. The window's prediction,
//! `client/web/src/tiling/arrangement.ts`, mirrors it, and the golden
//! traces hold the two together until T1 runs this code there (ADR 0088,
//! decision 11).

use crate::model::{self, Arrangement, PaneId, Place, Shown, Side, WorkspaceId};
use banda_kernel::ProjectId;
use serde::Serialize;
use std::collections::BTreeSet;
use uuid::Uuid;

/// How the Person works the Panes, as far as placement goes. Solo is each
/// client's view of the row (ADR 0087, decision 10).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Flow {
    /// Right of the Pane in front; workspaces belong to no Project.
    #[default]
    Free,
    /// Each Project on its own workspace (ADR 0102).
    Row,
}

/// What an engine knows beside its arrangement, and places a Pane by (ADR
/// 0110, decision 5). A client that draws ahead of the engine gives its
/// copy of the rule the same.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Facts {
    /// This machine's copy of the Flow.
    pub flow: Flow,
    /// The Pane kinds that stand on their Project's workspace
    /// (`PaneKind.home`).
    pub home: BTreeSet<String>,
}

/// Who a Pane is opened by, or for.
#[derive(Clone, Copy, Debug)]
pub enum By {
    /// The Person, or a program of theirs.
    Person,
    /// An Agent, of the Thread its pass was made for; none, when the window
    /// opens it for an Agent whose Thread no workspace shows.
    Agent { thread: Option<Uuid> },
}

/// A Pane to place, and the facts it is placed by.
#[derive(Clone, Copy, Debug)]
pub struct Asked {
    pub flow: Flow,
    pub project: ProjectId,
    /// Its kind opens as a Group of its own (`PaneKind.grouped`).
    pub grouped: bool,
    /// Its kind stands on its Project's workspace (`PaneKind.home`).
    pub home: bool,
    /// Its Project is no Project: a draft, or a scratch one (ADR 0046).
    pub scratch: bool,
    /// The Pane it is opened from, the one in front where its caller is.
    pub from: Option<PaneId>,
    /// The workspace on its caller's screen, for when no Pane is in front.
    pub on: Option<WorkspaceId>,
    pub by: By,
}

/// Where the Pane goes by the Flow; none, where a Pane with no place goes
/// (ADR 0102, decision 3).
///
/// What an Agent opens goes into its Thread's Group, while a workspace
/// shows the Thread; in the row, else, last on its Project's workspace, or,
/// of no Project, on the top free one. For the rest, in the Flow `free`:
/// right of the Pane in front, else last on the workspace on screen. In
/// the row:
/// - a Pane whose kind stands on its Project's workspace, a Thread, goes
///   last there, or, of no Project, on the top free one;
/// - with no Pane in front, into its Project's own Group, first on its
///   workspace; of no Project, last on the workspace on screen;
/// - from a Group of its Project, into that Group, of no Project too;
/// - another Pane of no Project, right of the Pane in front;
/// - from the Project's own Group, last into it;
/// - on a workspace no Project owns, right of the Pane in front;
/// - any other, last into its Project's own Group.
pub fn place(list: &Arrangement, asked: Asked) -> Option<Place> {
    let Asked {
        flow,
        project,
        grouped,
        home,
        scratch,
        from,
        on,
        by,
    } = asked;
    let right = |pane| Place::Beside {
        pane,
        side: Side::Right,
    };
    let its_workspace = if scratch {
        Place::Free
    } else {
        Place::Project { project }
    };
    if let By::Agent { thread } = by {
        let group = (thread.filter(|_| !grouped)).and_then(|t| agents_place(list, project, t));
        if group.is_some() {
            return group;
        }
        if flow == Flow::Row {
            return Some(its_workspace);
        }
    }
    // A Pane in front that has gone since counts as none, and so does a
    // workspace.
    let at = from.and_then(|pane| Some((pane, model::spot(list, pane).ok()?)));
    let here = || {
        let workspace = on.filter(|on| list.iter().any(|w| w.id == *on))?;
        Some(Place::Column {
            workspace,
            index: usize::MAX,
        })
    };
    if flow == Flow::Free {
        return at.map(|(pane, _)| right(pane)).or_else(here);
    }
    if home {
        return Some(its_workspace);
    }
    let Some((pane, at)) = at else {
        return if scratch {
            here()
        } else {
            Some(Place::Own { project })
        };
    };
    let workspace = &list[at.workspace];
    let column = &workspace.columns[at.column];
    let in_its_group = column.group.is_some() && column.panes[at.pane].shows.project == project;
    let group = Place::Group { pane };
    Some(if scratch {
        if in_its_group { group } else { right(pane) }
    } else if column.group.is_some() && column.group == workspace.own {
        Place::Own { project }
    } else if in_its_group {
        group
    } else if workspace.project.is_none() {
        // A free one: no Project owns it, and the Pane in front is on it.
        right(pane)
    } else {
        Place::Own { project }
    })
}

/// Whether a Pane opened in place of `instead`, which shows there what
/// that one showed in another Project, opens elsewhere: in the row, when
/// the workspace that holds `instead` is another Project's, as a draft the
/// Person moves to another Project, or to none (ADR 0102, decisions 1 and
/// 3). On a free workspace it changes Project where it stands.
pub fn moves_away(list: &Arrangement, flow: Flow, project: ProjectId, instead: PaneId) -> bool {
    let Ok(at) = model::spot(list, instead) else {
        return false;
    };
    let workspace = &list[at.workspace];
    let was = workspace.columns[at.column].panes[at.pane].shows.project;
    flow == Flow::Row && was != project && workspace.project.is_some_and(|owner| owner != project)
}

/// Where a Pane an Agent opens with no place goes: into its Thread's
/// Group, as a Diff opened from the Thread goes (ADR 0065, decision 7),
/// and a Thread in no Group starts one for it. Only the Thread's Pane of
/// `project` counts; with none on a workspace, it has no place here.
pub(crate) fn agents_place(list: &Arrangement, project: ProjectId, thread: Uuid) -> Option<Place> {
    let asked = Shown {
        project,
        kind: "agents.thread".into(),
        args: serde_json::json!({ "thread": thread.to_string() }),
    };
    model::showing_asked(list, &asked).map(|pane| Place::Group { pane: pane.id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::tests::{opened, seed, shown};
    use crate::model::{group_pane, start};

    /// What is opened from: the Pane in front, the workspace on screen, and
    /// who opens it.
    type From = (Option<PaneId>, Option<WorkspaceId>, By);

    fn asked(project: ProjectId, flow: Flow, (from, on, by): From) -> Asked {
        Asked {
            flow,
            project,
            grouped: false,
            home: false,
            scratch: false,
            from,
            on,
            by,
        }
    }

    const NOTHING: From = (None, None, By::Person);
    const FOR_AGENT: By = By::Agent { thread: None };
    const AGENT: From = (None, None, FOR_AGENT);

    fn from(pane: PaneId) -> From {
        (Some(pane), None, By::Person)
    }

    fn on(workspace: WorkspaceId) -> From {
        (None, Some(workspace), By::Person)
    }

    fn there(workspace: WorkspaceId) -> Option<Place> {
        Some(Place::Column {
            workspace,
            index: usize::MAX,
        })
    }

    fn scratch(asked: Asked) -> Asked {
        Asked {
            scratch: true,
            ..asked
        }
    }

    fn right(pane: PaneId) -> Option<Place> {
        Some(Place::Beside {
            pane,
            side: Side::Right,
        })
    }

    fn own(project: ProjectId) -> Option<Place> {
        Some(Place::Own { project })
    }

    fn on_its_workspace(project: ProjectId) -> Option<Place> {
        Some(Place::Project { project })
    }

    /// One Pane of a new Project, at `to`.
    fn one_pane(to: impl Fn(ProjectId) -> Option<Place>) -> (Arrangement, ProjectId, PaneId) {
        let mut list = start();
        let work = ProjectId::new();
        let pane = opened(&mut list, shown(work, "a.a", 1), to(work));
        (list, work, pane)
    }

    #[test]
    fn in_the_flow_free_a_pane_goes_right_of_the_one_in_front() {
        let (list, work, pane) = one_pane(|_| None);
        let plain = asked(work, Flow::Free, from(pane));
        let at_home = Asked {
            home: true,
            ..plain
        };
        assert_eq!(place(&list, plain), right(pane));
        assert_eq!(place(&list, at_home), right(pane));
        assert_eq!(place(&list, asked(work, Flow::Free, NOTHING)), None);
    }

    #[test]
    fn a_pane_in_front_that_has_gone_counts_as_none() {
        let (list, work, _) = one_pane(|_| None);
        let gone = from(PaneId::new());
        assert_eq!(place(&list, asked(work, Flow::Free, gone)), None);
        assert_eq!(place(&list, asked(work, Flow::Row, gone)), own(work));
    }

    #[test]
    fn in_the_flow_free_an_agents_pane_owns_no_workspace() {
        let (list, work, _) = one_pane(on_its_workspace);
        assert_eq!(place(&list, asked(work, Flow::Free, AGENT)), None);
    }

    #[test]
    fn a_thread_and_what_an_agent_opens_go_on_their_projects_workspace() {
        let list = start();
        let work = ProjectId::new();
        let at_home = Asked {
            home: true,
            ..asked(work, Flow::Row, NOTHING)
        };
        assert_eq!(place(&list, at_home), on_its_workspace(work));
        let agent = asked(work, Flow::Row, AGENT);
        assert_eq!(place(&list, agent), on_its_workspace(work));
        // Of no Project, on the top free workspace.
        assert_eq!(place(&list, scratch(agent)), Some(Place::Free));
    }

    #[test]
    fn with_nothing_in_front_a_pane_goes_into_its_projects_own_group() {
        let list = start();
        let work = ProjectId::new();
        let asked = asked(work, Flow::Row, NOTHING);
        assert_eq!(place(&list, asked), own(work));
        assert_eq!(place(&list, scratch(asked)), None);
    }

    #[test]
    fn from_a_group_of_its_project_a_pane_joins_that_group() {
        let (mut list, work, pane) = one_pane(on_its_workspace);
        group_pane(&mut list, pane, &seed()).unwrap();
        let group = Some(Place::Group { pane });
        let there = asked(work, Flow::Row, from(pane));
        assert_eq!(place(&list, there), group);
        assert_eq!(place(&list, scratch(there)), group);
        // Of another Project, not.
        let other = ProjectId::new();
        assert_eq!(place(&list, asked_row(other, pane)), own(other));
    }

    fn asked_row(project: ProjectId, pane: PaneId) -> Asked {
        asked(project, Flow::Row, from(pane))
    }

    #[test]
    fn from_the_projects_own_group_a_pane_goes_last_into_it() {
        let (list, work, pane) = one_pane(own);
        assert_eq!(place(&list, asked_row(work, pane)), own(work));
    }

    #[test]
    fn on_a_free_workspace_a_pane_goes_right_of_the_one_in_front() {
        let (list, work, pane) = one_pane(|_| None);
        assert_eq!(place(&list, asked_row(work, pane)), right(pane));
    }

    #[test]
    fn of_no_project_a_pane_in_no_group_goes_right_of_the_one_in_front() {
        let (list, work, pane) = one_pane(on_its_workspace);
        assert_eq!(place(&list, scratch(asked_row(work, pane))), right(pane));
    }

    #[test]
    fn on_a_projects_workspace_outside_a_group_a_pane_goes_into_the_own_group() {
        let (list, work, pane) = one_pane(on_its_workspace);
        assert_eq!(place(&list, asked_row(work, pane)), own(work));
    }

    #[test]
    fn with_no_pane_in_front_the_flow_free_takes_the_workspace_on_screen() {
        let (list, work, _) = one_pane(|_| None);
        let bottom = list.last().unwrap().id;
        assert_eq!(
            place(&list, asked(work, Flow::Free, on(bottom))),
            there(bottom)
        );
        // One that has gone since counts as none.
        let gone = on(WorkspaceId::new());
        assert_eq!(place(&list, asked(work, Flow::Free, gone)), None);
    }

    #[test]
    fn of_no_project_with_no_pane_in_front_a_pane_stays_on_the_workspace_on_screen() {
        let (list, work, _) = one_pane(|_| None);
        let bottom = list.last().unwrap().id;
        let here = asked(work, Flow::Row, on(bottom));
        assert_eq!(place(&list, scratch(here)), there(bottom));
        // A Project's goes home all the same.
        assert_eq!(place(&list, here), own(work));
    }

    #[test]
    fn what_the_window_opens_for_an_agent_goes_as_the_agents_own() {
        let (list, work, pane) = one_pane(on_its_workspace);
        let other = ProjectId::new();
        let agents = |flow| asked(other, flow, (Some(pane), None, FOR_AGENT));
        // In the row, home, whatever is in front; in the Flow free, right
        // of the Pane in front, as the Person's.
        assert_eq!(place(&list, agents(Flow::Row)), on_its_workspace(other));
        assert_eq!(place(&list, agents(Flow::Free)), right(pane));
        assert_eq!(place(&list, asked(work, Flow::Free, AGENT)), None);
    }

    #[test]
    fn a_pane_moved_to_another_project_leaves_a_workspace_that_is_not_its_own() {
        let (mut list, work, pane) = one_pane(on_its_workspace);
        let other = ProjectId::new();
        assert!(moves_away(&list, Flow::Row, other, pane));
        // Not in the Flow free, in its own Project, or when it has gone.
        assert!(!moves_away(&list, Flow::Free, other, pane));
        assert!(!moves_away(&list, Flow::Row, work, pane));
        assert!(!moves_away(&list, Flow::Row, other, PaneId::new()));
        // On a free workspace it changes Project where it stands.
        let free = opened(&mut list, shown(work, "a.a", 2), Some(Place::Free));
        assert!(!moves_away(&list, Flow::Row, other, free));
    }
}
