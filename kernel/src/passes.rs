//! A pass is how an Agent's session reaches the engine (ADR 0019,
//! decision 2). The agents module asks for one when it opens a session,
//! and hands it to `banda mcp`. Whoever says it in `hello` is that Agent,
//! and works only in that Project.
//!
//! Passes are kept in memory. They end with the engine, and each session
//! opened, again too, gets a new pass.

use crate::{AgentId, Error, ProjectId};
use std::collections::HashMap;
use std::sync::Mutex;

/// A secret no one can guess: 32 random bytes, in hex.
pub fn secret() -> Result<String, Error> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| Error::Io(std::io::Error::other(e)))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// The passes of this run of the engine, each with the Agent it names and
/// the Project it works in.
#[derive(Default)]
pub(crate) struct Passes(Mutex<HashMap<String, (AgentId, ProjectId)>>);

impl Passes {
    /// A new pass for `agent` in `project`.
    pub(crate) fn issue(&self, agent: AgentId, project: ProjectId) -> Result<String, Error> {
        let pass = secret()?;
        self.0
            .lock()
            .unwrap()
            .insert(pass.clone(), (agent, project));
        Ok(pass)
    }

    /// The Agent `pass` names and the Project it works in, or `None`.
    pub(crate) fn holder(&self, pass: &str) -> Option<(AgentId, ProjectId)> {
        self.0.lock().unwrap().get(pass).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pass_names_its_agent_and_its_project_and_nothing_else_does() {
        let passes = Passes::default();
        let (agent, project) = (AgentId::new(), ProjectId::new());
        let pass = passes.issue(agent, project).unwrap();
        assert_eq!(pass.len(), 64);
        assert!(pass.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(passes.holder(&pass), Some((agent, project)));
        assert_ne!(
            passes.issue(agent, project).unwrap(),
            pass,
            "a session gets its own"
        );
        assert_eq!(passes.holder(""), None);
        assert_eq!(passes.holder(&secret().unwrap()), None);
    }
}
