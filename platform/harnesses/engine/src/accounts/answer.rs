//! What a machine says of its Accounts, in one answer (ADR 0108, decision
//! 4): each entry, the Harnesses they are accounts of with what a new one
//! is called, and which of them a new Thread starts on. The window, the CLI
//! and an Agent read it and work out none of it.

use crate::model::HarnessView;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;

/// The list of a machine's Accounts as of its log's position `at`: a
/// window reads it again on a `list_changed` after it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct AccountList {
    #[ts(type = "number")]
    pub at: i64,
    /// Every entry, as `list` gives them.
    pub accounts: Vec<HarnessView>,
    /// The Harnesses they are accounts of, each where its first entry
    /// stands.
    pub harnesses: Vec<HarnessOf>,
    /// Where a new Thread starts: `agents.toml`'s `start.account` while it
    /// is on, else the first entry on. None while none is on.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    /// Where a new Thread starts while the default is out of its limits:
    /// `start.fallback` while it is on and is not the default.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

/// A Harness whose accounts the list holds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct HarnessOf {
    /// Its ID, as its entries' `harness` says it.
    pub id: String,
    /// What its accounts are grouped under: `Claude Code`, never one
    /// account's name.
    pub title: String,
    /// What a new account of it is called and coloured.
    pub next: NewAccount,
    /// The models in its menu, as `agents.toml`'s `[models]` names them:
    /// none when it names none, and the menu is the first three the
    /// Harness offers (ADR 0114, decision 7).
    pub models: Vec<String>,
}

/// What a new account of a Harness is called and coloured, beside the
/// ones it has.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "harnesses/")]
pub struct NewAccount {
    /// The first of `claude`, `claude-2`, `claude-3`… that no entry has.
    pub id: String,
    pub name: String,
    /// The one of the four its accounts use least (ADR 0093, decision 3).
    pub colour: u8,
}

/// The list of `accounts` as of its machine's log's position `at`, as
/// `agents.toml`'s `[start]` names its default and fallback.
pub(super) fn answer(
    at: i64,
    accounts: Vec<HarnessView>,
    (account, fallback): (Option<String>, Option<String>),
    mut models: BTreeMap<String, Vec<String>>,
) -> AccountList {
    let (default, fallback) = roles(&accounts, account.as_deref(), fallback.as_deref());
    let mut harnesses: Vec<HarnessOf> = Vec::new();
    for one in &accounts {
        if harnesses.iter().any(|h| h.id == one.harness) {
            continue;
        }
        let theirs: Vec<_> = (accounts.iter())
            .filter(|other| other.harness == one.harness)
            .collect();
        let title = title(&accounts, &one.harness);
        let (name, colour) = fresh(&title, &theirs);
        harnesses.push(HarnessOf {
            id: one.harness.clone(),
            title,
            next: NewAccount {
                id: free_id(&one.harness, &accounts),
                name,
                colour,
            },
            models: models.remove(&one.harness).unwrap_or_default(),
        });
    }
    AccountList {
        at,
        accounts,
        harnesses,
        default,
        fallback,
    }
}

/// The default and the fallback among `accounts`, as `[start]` names
/// them: an account that is off takes no role, the default is the first
/// one on when `account` names none on, and the fallback is never the
/// default.
pub(super) fn roles(
    accounts: &[HarnessView],
    account: Option<&str>,
    fallback: Option<&str>,
) -> (Option<String>, Option<String>) {
    let on = |id: Option<&str>| (accounts.iter()).find(|one| one.enabled && Some(&*one.id) == id);
    let default = on(account).or_else(|| accounts.iter().find(|one| one.enabled));
    let fallback = on(fallback).filter(|one| Some(*one) != default);
    let id = |one: Option<&HarnessView>| one.map(|one| one.id.clone());
    (id(default), id(fallback))
}

/// What the accounts of `harness` are grouped under: the name of the
/// program Banda knows it as, else its own entry's, else its first
/// account's.
pub(super) fn title(accounts: &[HarnessView], harness: &str) -> String {
    let named = |found: Option<&HarnessView>| found.map(|one| one.name.clone());
    (crate::list::program(harness).map(str::to_owned))
        .or_else(|| named(accounts.iter().find(|one| one.id == harness)))
        .or_else(|| named(accounts.iter().find(|one| one.harness == harness)))
        .unwrap_or_else(|| harness.to_owned())
}

/// The first of `base`, `base-2`, `base-3`… that none of `accounts` has.
fn free_id(base: &str, accounts: &[HarnessView]) -> String {
    let free = |id: &str| accounts.iter().all(|one| one.id != id);
    (std::iter::once(base.to_owned()))
        .chain((2..).map(|n| format!("{base}-{n}")))
        .find(|id| free(id))
        .expect("the numbers do not run out")
}

/// What a new account is called and coloured beside `theirs`, the entries
/// of its Harness `title`: `C4` beside C1 to C3, else `Claude Code 2`; and
/// the colour its accounts use least, written with it so it repaints none
/// of them (ADR 0093, decision 3).
pub(super) fn fresh(title: &str, theirs: &[&HarnessView]) -> (String, u8) {
    // A name that ends in a number: what goes before it, and the number.
    let numbered = |name: &str| -> Option<(String, u64)> {
        let prefix = name.trim_end_matches(|c: char| c.is_ascii_digit());
        Some((prefix.to_owned(), name[prefix.len()..].parse().ok()?))
    };
    let numbered: Option<Vec<_>> = theirs.iter().map(|h| numbered(&h.name)).collect();
    let name = match numbered.as_deref() {
        Some(all @ [(prefix, _), ..]) if all.iter().all(|(p, _)| p == prefix) => {
            let next = all.iter().map(|(_, n)| n + 1).max().unwrap_or(1);
            format!("{prefix}{next}")
        }
        _ => format!("{title} {}", theirs.len() + 1),
    };
    let colour = (1..=crate::list::COLOURS as u8)
        .min_by_key(|colour| theirs.iter().filter(|h| h.colour == *colour).count())
        .unwrap_or(1);
    (name, colour)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::AccountKind;

    fn entry(id: &str, harness: &str, name: &str, enabled: bool, colour: u8) -> HarnessView {
        HarnessView {
            id: id.into(),
            name: name.into(),
            short: name.into(),
            enabled,
            command: vec![],
            env: vec![],
            harness: harness.into(),
            kind: AccountKind::Subscription,
            mark: name[..1].into(),
            icon: None,
            colour,
            sessions: harness.into(),
        }
    }

    fn list() -> Vec<HarnessView> {
        vec![
            entry("claude", "claude", "Work", true, 0),
            entry("c2", "claude", "Personal", false, 1),
            entry("codex", "codex", "Codex", true, 0),
            entry("pi", "pi", "Pi", true, 0),
        ]
    }

    fn start(account: Option<&str>, fallback: Option<&str>) -> (Option<String>, Option<String>) {
        (account.map(Into::into), fallback.map(Into::into))
    }

    #[test]
    fn the_default_and_the_fallback_are_on_and_never_the_same() {
        let roles = |account, fallback| {
            let said = answer(0, list(), start(account, fallback), BTreeMap::new());
            (said.default, said.fallback)
        };
        let some = |id: &str| Some(id.to_owned());
        assert_eq!(
            roles(Some("codex"), Some("claude")),
            (some("codex"), some("claude"))
        );
        // None named, or one that is off or gone: the first one on.
        assert_eq!(roles(None, None), (some("claude"), None));
        assert_eq!(roles(Some("c2"), None), (some("claude"), None));
        assert_eq!(roles(Some("gone"), None), (some("claude"), None));
        // A fallback that is off, or is the default, is none.
        assert_eq!(roles(None, Some("c2")), (some("claude"), None));
        assert_eq!(roles(None, Some("claude")), (some("claude"), None));
        let off: Vec<_> = (list().into_iter())
            .map(|one| HarnessView {
                enabled: false,
                ..one
            })
            .collect();
        let said = answer(
            0,
            off,
            start(Some("claude"), Some("codex")),
            BTreeMap::new(),
        );
        assert_eq!((said.default, said.fallback), (None, None));
    }

    #[test]
    fn each_harness_has_its_title_and_its_next_account() {
        let said = answer(0, list(), start(None, None), BTreeMap::new());
        let of = |id: &str| said.harnesses.iter().find(|h| h.id == id).unwrap();
        assert_eq!(
            said.harnesses.iter().map(|h| &*h.id).collect::<Vec<_>>(),
            ["claude", "codex", "pi"]
        );
        // The program's name, never a renamed entry's.
        assert_eq!(of("claude").title, "Claude Code");
        assert_eq!(of("claude").next.name, "Claude Code 3");
        // Colour 1 is Personal's: the next takes the first left.
        assert_eq!(of("claude").next.colour, 2);
        // `claude` is its own entry's ID.
        assert_eq!(of("claude").next.id, "claude-2");
        assert_eq!(of("codex").next.id, "codex-2");
        // A Harness Banda does not know is called as its own entry.
        assert_eq!(of("pi").title, "Pi");
        let numbered = vec![
            entry("c1", "claude", "C1", true, 1),
            entry("c3", "claude", "C3", true, 2),
        ];
        let said = answer(0, numbered, start(None, None), BTreeMap::new());
        assert_eq!(said.harnesses[0].next.name, "C4");
    }

    #[test]
    fn each_harness_has_its_menu_of_models_as_written() {
        let models = BTreeMap::from([
            (
                "claude".to_owned(),
                vec!["opus".to_owned(), "haiku".to_owned()],
            ),
            ("gone".to_owned(), vec!["x".to_owned()]),
        ]);
        let said = answer(0, list(), start(None, None), models);
        let of = |id: &str| said.harnesses.iter().find(|h| h.id == id).unwrap();
        assert_eq!(of("claude").models, ["opus", "haiku"]);
        // None named: the window takes the Harness's first three.
        assert!(of("codex").models.is_empty());
    }
}
