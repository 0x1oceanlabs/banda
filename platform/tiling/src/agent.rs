//! What an App says of a kind of Pane an Agent may open: the engine hands
//! each App's to the workspaces, which keep the wall by them and name no
//! App (#1798, step 3).

use banda_base::{ProjectId, Refusal};
use serde_json::Value;

/// A kind of Pane an Agent may open, as the App whose it is says: the
/// engine hands the workspaces each App's, so they name no App for it. A
/// kind is one when it shows, and runs nothing as the Person: a
/// terminal's runs the Person's shell, and the command its `done` sends
/// goes as the Person (ADR 0032). Only the Person's gesture acts as the
/// Person (ADR 0083, decision 3), so `opens` refuses an Agent every arg
/// that would send or start something.
#[derive(Clone, Copy)]
pub struct AgentPane {
    /// Its kind, `<module>.<pane>`.
    pub kind: &'static str,
    /// Refuses the args an Agent may not open it with.
    pub opens: fn(&Value) -> Result<(), Refusal>,
    /// Its args as an Agent of this Project sees them; none, whole.
    pub seen: Option<fn(&Value, ProjectId) -> Value>,
    /// The arg that names the folder it shows and the one that names a
    /// row in it, for a kind that shows a folder: the workspaces hold
    /// both inside the Agent's Project, and keep the folder whole (ADR
    /// 0073, decision 14).
    pub folder: Option<(&'static str, &'static str)>,
}

impl AgentPane {
    /// A kind whose args choose only what it shows: an Agent gives any,
    /// and sees them whole.
    pub const fn shows(kind: &'static str) -> Self {
        Self {
            kind,
            opens: |_| Ok(()),
            seen: None,
            folder: None,
        }
    }
}

/// Refuses any arg but `shows`, the ones an Agent gives a kind of Pane:
/// for an [`AgentPane`]'s `opens`.
pub fn shows_only(args: &Value, shows: &[&str]) -> Result<(), Refusal> {
    let mut given = args.as_object().into_iter().flat_map(|args| args.keys());
    match given.find(|arg| !shows.contains(&arg.as_str())) {
        None => Ok(()),
        Some(other) => {
            let shows: Vec<_> = shows.iter().map(|arg| format!("`{arg}`")).collect();
            Err(Refusal::forbidden(format!(
                "`{other}` is your Person's to give: an Agent gives this Pane only {}.",
                shows.join(", ")
            )))
        }
    }
}
