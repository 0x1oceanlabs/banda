//! What `tiling.toml` says of where a Pane opens, resolved: the Flow, and
//! a rule for a kind of Pane with its lines (ADR 0127; ADR 0135, decision
//! 6). `placing` reads them; the file's reader is the engine's
//! (`banda-workspaces`, `tiling.rs`).

use crate::placing::{self, Via};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How an Agent's windows stand, its Flow (ADR 0079): where its Thread
/// opens, and what a pick of it shows.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "workspaces/")]
pub enum Flow {
    /// Where the window has it: beside the Pane in front, and a pick goes
    /// to wherever its Pane is. `off` before ADR 0079 (grace).
    #[serde(alias = "off")]
    Free,
    /// Each Project on its own workspace, its Agents in a row, a pick at
    /// the left (ADR 0065, ADR 0102). `project` before ADR 0079, `space`
    /// before ADR 0069 (grace).
    #[default]
    #[serde(alias = "project")]
    #[serde(alias = "space")]
    Row,
    /// The row, and a device that has not chosen starts in Solo: what
    /// has the focus fills the screen (ADR 0102). Each device turns Solo
    /// on and off for itself.
    Solo,
}

impl From<Flow> for placing::Flow {
    /// Solo is each client's view of the row (ADR 0087, decision 10): the
    /// engine places by the row. A device turns Solo on and off for
    /// itself and writes nothing, so `solo` in the file is the Person's
    /// default, for a device that has not chosen (ADR 0127, decision 3).
    fn from(flow: Flow) -> Self {
        match flow {
            Flow::Free => Self::Free,
            Flow::Row | Flow::Solo => Self::Row,
        }
    }
}

/// Where a Pane opens when no one named a place, as a rule of its kind
/// says. Each is a place `placing` gives already: a rule chooses among
/// them, by the Pane in front.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "workspaces/")]
pub enum Opens {
    /// Right of the Pane in front, in a column of its own.
    Beside,
    /// Under the Pane in front, in its column.
    Below,
    /// In the Group of the Pane in front, which starts one when it is in
    /// none (ADR 0065).
    Group,
    /// Last on its Project's workspace, in the row, as a Thread opens (ADR
    /// 0102).
    Project,
    /// Right of the whole Group of the Pane in front (ADR 0134, decision
    /// 2).
    BesideGroup,
    /// First on its Project's workspace, in the row, right of its columns
    /// in no Group (ADR 0134, decision 3).
    ProjectStart,
    /// Last on the workspace on screen.
    Here,
}

/// What a line of a rule asks of the Pane in front (ADR 0135, decision 6).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "workspaces/")]
pub enum Front {
    /// There is one.
    Pane,
    /// It is a Thread, or a Pane in a Group.
    Group,
}

/// A line of a rule: where a Pane of the kind opens when it is asked for
/// this way (ADR 0135, decision 6). What a line leaves out, it does not
/// ask. The first line that holds, and whose place can be made, decides;
/// then the rule's own `opens`; then Banda's lines for the Flow.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "workspaces/")]
pub struct When {
    /// How the Person asked: "click", in the Pane in front, a path or a
    /// link; or "key", a key, a menu, the sidebar or `banda`. A line that
    /// says it never holds for what an Agent opens.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<Via>,
    /// What is in front: "pane", any Pane; or "group", a Thread or a Pane
    /// in a Group.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Front>,
    /// Where it opens then, as the rule's `opens` says a place.
    pub opens: Opens,
}

/// A rule for one kind of Pane, resolved.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize, TS)]
#[ts(export, export_to = "workspaces/")]
pub struct Rule {
    /// A new column's width for a Pane of this kind, a share of the screen.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<String>,
    /// Where a Pane of this kind opens when no one named a place.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opens: Option<Opens>,
    /// Its lines by how a Pane is asked for and from what, in order.
    #[ts(as = "Option<Vec<When>>", optional)]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub when: Vec<When>,
}
