//! What a module hears of another, as its manifest declares it (ADR 0082,
//! decision 2): `[needs.listens]` of its `app.toml`, one table for each
//! listener, by its name, with the part it hears and the kinds of its
//! facts.
//!
//! ```toml
//! [needs.listens.copies]
//! from = "notes"
//! kinds = ["added", "removed"]
//! ```
//!
//! A module's own facts it hears as it likes. Another's it hears only
//! through a listener its manifest declares, and no more of them than it
//! declares, so who hears whom is read in the manifests, and no module's
//! code names another for it.

use crate::module::Module;
use crate::{EventFilter, Refusal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Deserialize, Default)]
struct Manifest {
    #[serde(default)]
    needs: Needs,
}

#[derive(Deserialize, Default)]
struct Needs {
    #[serde(default)]
    listens: BTreeMap<String, Listens>,
}

/// What one listener hears, as a manifest's `[needs.listens.<name>]`
/// says it: the part whose facts they are, and their kinds.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Listens {
    pub from: String,
    pub kinds: Vec<String>,
}

/// The facts `module`'s listener `name` hears of another part, as its
/// manifest declares them. Refused when it declares none by that name.
pub(crate) fn declared(module: &dyn Module, name: &str) -> Result<EventFilter, Refusal> {
    let id = module.name();
    let manifest: Manifest = toml::from_str(module.manifest())
        .map_err(|error| Refusal::invalid(format!("{id}'s manifest is not read: {error}")))?;
    let Some(listens) = manifest.needs.listens.get(name) else {
        return Err(Refusal::forbidden(format!(
            "{id} declares no listener {name}: what it hears of another part, its app.toml says in [needs.listens.{name}]."
        )));
    };
    Ok(EventFilter {
        module: Some(listens.from.clone()),
        subject: None,
        kinds: Some(listens.kinds.clone()),
    })
}

/// Whether `module`'s listener `name` may hear what `filter` matches: its
/// own facts, or those of another part its manifest declares for `name`.
pub(crate) fn admits(module: &dyn Module, name: &str, filter: &EventFilter) -> Result<(), Refusal> {
    let id = module.name();
    let Some(from) = filter.module.as_deref() else {
        return Err(Refusal::invalid(format!(
            "{id}'s listener {name} names the part it hears."
        )));
    };
    if from == id || module.was().contains(&from) {
        return Ok(());
    }
    let declared = declared(module, name)?;
    let kinds = declared.kinds.unwrap_or_default();
    let within = declared.module.as_deref() == Some(from)
        && (filter.kinds.as_ref())
            .is_some_and(|asked| asked.iter().all(|kind| kinds.contains(kind)));
    if within {
        Ok(())
    } else {
        Err(Refusal::forbidden(format!(
            "{id}'s listener {name} hears more of {from} than its app.toml declares in [needs.listens.{name}]."
        )))
    }
}
