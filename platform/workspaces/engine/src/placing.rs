//! Where a Pane goes when no one named a place: the Tiling's placement
//! policy (ADR 0110). It only decides, from the arrangement and the facts
//! it is given; `model` does what it decides. The window's prediction
//! follows it until T1 runs this code there (ADR 0088, decision 11).

use crate::model::{self, Arrangement, PaneId, Place, Shown, Side};
use banda_kernel::ProjectId;
use uuid::Uuid;

/// How the Person works the Panes, as far as placement goes. Solo is each
/// client's view of the row (ADR 0087, decision 10).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flow {
    /// Right of the Pane in front; workspaces belong to no Project.
    Free,
    /// Each Project on its own workspace (ADR 0102).
    Row,
}

/// Who opens a Pane, and from where.
#[derive(Clone, Copy, Debug)]
pub enum By {
    /// The Person or a program, from the Pane in front when there is one.
    Person { from: Option<PaneId> },
    /// An Agent, of the Thread its pass was made for.
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
    pub by: By,
}

/// Where the Pane goes by the Flow; none, where a Pane with no place goes
/// (ADR 0102, decision 3).
pub fn place(list: &Arrangement, asked: Asked) -> Option<Place> {
    let Asked {
        flow,
        project,
        grouped,
        home,
        scratch,
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
    let from = match by {
        By::Agent { thread } => {
            let group = (thread.filter(|_| !grouped)).and_then(|t| agents_place(list, project, t));
            return group.or((flow == Flow::Row).then_some(its_workspace));
        }
        By::Person { from } => from,
    };
    // A Pane in front that has gone since counts as none.
    let at = from.and_then(|pane| Some((pane, model::spot(list, pane).ok()?)));
    if flow == Flow::Free {
        return at.map(|(pane, _)| right(pane));
    }
    if home {
        return Some(its_workspace);
    }
    let Some((pane, at)) = at else {
        return (!scratch).then_some(Place::Own { project });
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

    fn asked(project: ProjectId, flow: Flow, by: By) -> Asked {
        Asked {
            flow,
            project,
            grouped: false,
            home: false,
            scratch: false,
            by,
        }
    }

    const NOTHING: By = By::Person { from: None };
    const AGENT: By = By::Agent { thread: None };

    fn from(pane: PaneId) -> By {
        By::Person { from: Some(pane) }
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
}
