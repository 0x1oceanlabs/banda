//! What a Thread's turns changed in files, from the diffs their tool calls
//! carry, not from git (ADR 0034, decision 2): the Diff's Turn scope reads
//! it, in any Project.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Body, Item, ThreadId, ToolContent, ToolStatus, TurnId, TurnView};

/// What `agents.changes` is asked.
#[derive(Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ChangesAsk {
    pub thread: ThreadId,
    /// The turn whose files to give; none for only the list of turns.
    #[serde(default)]
    #[ts(optional)]
    pub turn: Option<TurnId>,
}

/// The turns of a Thread that changed files, and the files of one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct TurnChanges {
    /// Where the Project's log stood: the Pane follows its events after.
    #[ts(type = "number")]
    pub at: i64,
    /// The turns that changed files, the latest first.
    pub turns: Vec<ChangedTurn>,
    /// The files the turn asked changed, in the order it first changed
    /// them; empty when none was asked.
    pub files: Vec<TurnFile>,
}

/// A turn that changed files.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ChangedTurn {
    pub turn: TurnId,
    /// Which turn of the Thread it is, from 1.
    pub n: u32,
    /// The start of the message that asked for it.
    pub said: String,
    /// How many files it changed.
    pub files: u32,
}

/// One file a turn changed, from how it was before the turn's first change
/// to after its last.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct TurnFile {
    pub path: String,
    /// Its text before; none when the turn made it.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old: Option<String>,
    pub new: String,
}

/// How much of a message names its turn.
const SAID: usize = 80;

/// The turns of `turns` that changed files, and the files of `asked`.
pub fn changes(
    items: &[Item],
    turns: &[TurnView],
    asked: Option<TurnId>,
) -> (Vec<ChangedTurn>, Vec<TurnFile>) {
    // Each turn's items, in one pass; only the asked turn's texts are copied.
    let mut by_turn: HashMap<TurnId, Vec<&Item>> = HashMap::new();
    for item in items {
        if let Some(turn) = item.turn {
            by_turn.entry(turn).or_default().push(item);
        }
    }
    let mut changed = Vec::new();
    let mut files = Vec::new();
    for (index, turn) in turns.iter().enumerate() {
        let made = files_of(by_turn.get(&turn.id).map_or(&[][..], Vec::as_slice));
        if made.is_empty() {
            continue;
        }
        changed.push(ChangedTurn {
            turn: turn.id,
            n: index as u32 + 1,
            said: said(items, turn),
            files: made.len() as u32,
        });
        if asked == Some(turn.id) {
            files = made
                .into_iter()
                .map(|(path, old, new)| TurnFile {
                    path: path.to_owned(),
                    old: old.map(str::to_owned),
                    new: new.to_owned(),
                })
                .collect();
        }
    }
    changed.reverse();
    (changed, files)
}

/// The files a turn's tool calls changed, each from before its first
/// change to after its last, in the order first changed. A failed call
/// changed nothing; a file changed back to how it was is left out. The
/// Thread's "Changed files" counts them the same way (`changes.ts`).
fn files_of<'a>(items: &[&'a Item]) -> Vec<(&'a str, Option<&'a str>, &'a str)> {
    let mut files: Vec<(&str, Option<&str>, &str)> = Vec::new();
    for item in items {
        let Body::Tool {
            status, content, ..
        } = &item.body
        else {
            continue;
        };
        if *status == ToolStatus::Failed {
            continue;
        }
        for part in content {
            let ToolContent::Diff { path, old, new } = part else {
                continue;
            };
            match files.iter_mut().find(|file| file.0 == path) {
                Some(file) => file.2 = new,
                None => files.push((path, old.as_deref(), new)),
            }
        }
    }
    files.retain(|(_, old, new)| *old != Some(*new));
    files
}

/// The start of the message that asked for `turn`, on one line.
fn said(items: &[Item], turn: &TurnView) -> String {
    let text = items
        .iter()
        .find(|item| item.id == turn.message)
        .and_then(|item| match &item.body {
            Body::Message { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .unwrap_or_default();
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match line.char_indices().nth(SAID) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Can, ItemId, ToolKind, TurnState};
    use banda_kernel::{Participant, PersonId};

    fn turn(message: ItemId) -> TurnView {
        TurnView {
            id: TurnId::new(),
            message,
            state: TurnState::Done,
            reason: None,
            failure: None,
            started: None,
            ended: None,
            plan: false,
            can: Can::default(),
        }
    }

    fn item(turn: Option<TurnId>, body: Body) -> Item {
        Item {
            id: ItemId::new(),
            turn,
            author: Participant::Person(PersonId::new()),
            at: 0,
            body,
        }
    }

    fn said(text: &str) -> Item {
        item(
            None,
            Body::Message {
                text: text.into(),
                images: vec![],
                answers: false,
            },
        )
    }

    fn edit(turn: TurnId, status: ToolStatus, path: &str, old: Option<&str>, new: &str) -> Item {
        item(
            Some(turn),
            Body::Tool {
                title: format!("Edit {path}"),
                tool: ToolKind::Edit,
                status,
                content: vec![ToolContent::Diff {
                    path: path.into(),
                    old: old.map(Into::into),
                    new: new.into(),
                }],
                output: None,
            },
        )
    }

    #[test]
    fn a_turn_changed_each_file_from_before_its_first_edit_to_after_its_last() {
        let (ask, again) = (said("Make  b\nthree"), said("Nothing"));
        let (first, second) = (turn(ask.id), turn(again.id));
        let items = vec![
            ask.clone(),
            edit(first.id, ToolStatus::Done, "a.ts", Some("1"), "2"),
            edit(first.id, ToolStatus::Done, "new.ts", None, "x"),
            edit(first.id, ToolStatus::Done, "a.ts", Some("2"), "3"),
            edit(first.id, ToolStatus::Failed, "failed.ts", Some("1"), "2"),
            edit(first.id, ToolStatus::Done, "back.ts", Some("1"), "2"),
            edit(first.id, ToolStatus::Done, "back.ts", Some("2"), "1"),
            again.clone(),
        ];
        let (turns, files) = changes(&items, &[first.clone(), second], Some(first.id));
        assert_eq!(
            turns,
            vec![ChangedTurn {
                turn: first.id,
                n: 1,
                said: "Make b three".into(),
                files: 2
            }]
        );
        assert_eq!(
            files,
            vec![
                TurnFile {
                    path: "a.ts".into(),
                    old: Some("1".into()),
                    new: "3".into()
                },
                TurnFile {
                    path: "new.ts".into(),
                    old: None,
                    new: "x".into()
                },
            ]
        );
    }

    #[test]
    fn the_turns_come_the_latest_first_and_no_files_without_one_asked() {
        let (one, two) = (said("one"), said(&"long ".repeat(40)));
        let (first, second) = (turn(one.id), turn(two.id));
        let items = vec![
            one.clone(),
            edit(first.id, ToolStatus::Done, "a", None, "a"),
            two.clone(),
            edit(second.id, ToolStatus::Done, "b", None, "b"),
        ];
        let (turns, files) = changes(&items, &[first, second], None);
        assert_eq!(
            turns.iter().map(|turn| turn.n).collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert!(turns[0].said.ends_with('…') && turns[0].said.chars().count() == 81);
        assert!(files.is_empty());
    }
}
