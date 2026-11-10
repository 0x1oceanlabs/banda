//! What a Thread's turns changed in files, from the diffs their tool calls
//! carry, not from git (ADR 0034, decision 2): the Diff's Turn scope reads
//! it, in any Project. A sub-agent's edits count in the turn it started
//! in (ADR 0103, decision 8).

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

/// How many lines a turn's tool calls, with its sub-agents' edits, added
/// and removed over every file it changed: what a Thread's card says of
/// it, as "+38 −9" (ADR 0098, decision 8).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "agents/")]
pub struct ChangedLines {
    pub added: u32,
    pub removed: u32,
}

/// How much of a message names its turn.
const SAID: usize = 80;

/// Beyond this many changed lines, or this many steps of looking, a file
/// counts as all removed, then all added, as the Thread's own diff shows
/// it (`diff.ts`), so the card and the Thread say the same.
const MOST_CHANGES: usize = 1000;
const MOST_STEPS: usize = 2_000_000;

/// The turns of `turns` that changed files, with its sub-agents' `edits`,
/// and the files of `asked`.
pub fn changes(
    items: &[Item],
    edits: &[Item],
    turns: &[TurnView],
    asked: Option<TurnId>,
) -> (Vec<ChangedTurn>, Vec<TurnFile>) {
    // Each turn's items, in one pass; only the asked turn's texts are copied.
    let mut by_turn: HashMap<TurnId, Vec<&Item>> = HashMap::new();
    for item in merged(items, edits) {
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

/// The Thread's `items` and its sub-agents' `edits`, each list in its own
/// order, as one list in the order they came: by `at`, the Thread's own
/// first when two came at once. The window merges them the same way
/// (`changes.ts`).
pub fn merged<'a>(items: &'a [Item], edits: &'a [Item]) -> Vec<&'a Item> {
    let (mut own, mut lanes) = (items.iter().peekable(), edits.iter().peekable());
    std::iter::from_fn(|| match (own.peek(), lanes.peek()) {
        (Some(a), Some(b)) if b.at < a.at => lanes.next(),
        (Some(_), _) => own.next(),
        (None, _) => lanes.next(),
    })
    .collect()
}

/// How many lines one turn's tool calls, `items`, with its sub-agents'
/// `edits`, added and removed over the files they changed: [`merged`] as
/// [`changes`] merges them, so the count is over the files the Thread's
/// "Changed files" shows for that turn. None when they changed no line,
/// so a turn that changed no file says nothing rather than "+0 −0".
pub fn lines_of(items: &[Item], edits: &[Item]) -> Option<ChangedLines> {
    let mut sum = ChangedLines {
        added: 0,
        removed: 0,
    };
    for (_, old, new) in files_of(&merged(items, edits)) {
        let counted = counted(old, new);
        sum.added += counted.added;
        sum.removed += counted.removed;
    }
    (sum.added > 0 || sum.removed > 0).then_some(sum)
}

/// How many lines a change from `before` to `after` added and removed:
/// the fewest, as Myers finds them, after the lines both start and end
/// with. Without `before` the file is new.
fn counted(before: Option<&str>, after: &str) -> ChangedLines {
    let (a, b) = (lines(before.unwrap_or_default()), lines(after));
    let start = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let (a, b) = (&a[start..], &b[start..]);
    let end = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let (a, b) = (&a[..a.len() - end], &b[..b.len() - end]);
    let (n, m) = (a.len(), b.len());
    // The fewest edits remove n − m more lines than they add.
    let edits = fewest_edits(a, b).unwrap_or(n + m);
    ChangedLines {
        added: ((edits + m - n) / 2) as u32,
        removed: ((edits + n - m) / 2) as u32,
    }
}

/// A text's lines; a last newline ends a line and starts none.
fn lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut all: Vec<&str> = text.split('\n').collect();
    if all.last() == Some(&"") {
        all.pop();
    }
    all
}

/// How many lines, removed or added, the fewest edits from `a` to `b`
/// take, as Myers walks them; none past [`MOST_CHANGES`] or
/// [`MOST_STEPS`], counted step for step as `diff.ts` counts them.
fn fewest_edits(a: &[&str], b: &[&str]) -> Option<usize> {
    let (n, m) = (a.len() as isize, b.len() as isize);
    let offset = MOST_CHANGES as isize + 1;
    let at = |k: isize| (offset + k) as usize;
    // The furthest x on each diagonal k, after each number of edits d.
    let mut furthest = vec![0_isize; 2 * offset as usize + 1];
    let mut looked = 0;
    for d in 0..=(n + m).min(MOST_CHANGES as isize) {
        for k in (-d..=d).step_by(2) {
            looked += 1;
            if looked > MOST_STEPS {
                return None;
            }
            let down = k == -d || (k != d && furthest[at(k - 1)] < furthest[at(k + 1)]);
            let mut x = if down {
                furthest[at(k + 1)]
            } else {
                furthest[at(k - 1)] + 1
            };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
                looked += 1;
            }
            furthest[at(k)] = x;
            if x >= n && y >= m {
                return Some(d as usize);
            }
        }
    }
    None
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
            harness: None,
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
        let (turns, files) = changes(&items, &[], &[first.clone(), second], Some(first.id));
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

    fn at(at: i64, mut item: Item) -> Item {
        item.at = at;
        item
    }

    #[test]
    fn merged_keeps_each_lists_order_and_puts_the_threads_own_item_first_on_a_tie() {
        let turn = turn(ItemId::new());
        let one = |at_ms, path: &str| at(at_ms, edit(turn.id, ToolStatus::Done, path, None, "x"));
        let items = [one(1, "a"), one(3, "b"), one(3, "c"), one(9, "d")];
        let edits = [one(0, "w"), one(3, "x"), one(5, "y"), one(20, "z")];
        let paths = |all: Vec<&Item>| -> Vec<String> {
            all.iter()
                .map(|item| match &item.body {
                    Body::Tool { title, .. } => title.trim_start_matches("Edit ").to_owned(),
                    _ => String::new(),
                })
                .collect()
        };
        assert_eq!(
            paths(merged(&items, &edits)),
            ["w", "a", "b", "c", "x", "y", "d", "z"]
        );
        assert_eq!(paths(merged(&items, &[])), ["a", "b", "c", "d"]);
        assert_eq!(paths(merged(&[], &edits)), ["w", "x", "y", "z"]);
        // A list out of order keeps its own order: the merge only interleaves.
        let late = [one(7, "late"), one(2, "early")];
        assert_eq!(
            paths(merged(&items, &late)),
            ["a", "b", "c", "late", "early", "d"]
        );
    }

    #[test]
    fn a_sub_agents_edits_count_in_the_turn_it_started_in() {
        let ask = said("Fix it");
        let first = turn(ask.id);
        let own = at(5, edit(first.id, ToolStatus::Done, "a.ts", Some("1"), "2"));
        let edits = [
            at(2, edit(first.id, ToolStatus::Done, "a.ts", Some("0"), "1")),
            at(6, edit(first.id, ToolStatus::Done, "b.ts", None, "b")),
            at(7, edit(first.id, ToolStatus::Failed, "c.ts", None, "c")),
        ];
        let (turns, files) = changes(
            &[ask, own],
            &edits,
            std::slice::from_ref(&first),
            Some(first.id),
        );
        assert_eq!(turns[0].files, 2, "{turns:?}");
        let a = &files[0];
        assert_eq!(
            (a.path.as_str(), a.old.as_deref(), a.new.as_str()),
            ("a.ts", Some("0"), "2"),
            "from before the sub-agent's edit to after the Agent's"
        );
        assert_eq!(files[1].path, "b.ts");
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
        let (turns, files) = changes(&items, &[], &[first, second], None);
        assert_eq!(
            turns.iter().map(|turn| turn.n).collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert!(turns[0].said.ends_with('…') && turns[0].said.chars().count() == 81);
        assert!(files.is_empty());
    }

    fn changed(added: u32, removed: u32) -> ChangedLines {
        ChangedLines { added, removed }
    }

    #[test]
    fn a_turn_s_lines_are_its_files_from_before_their_first_edit_to_after_their_last() {
        let turn = TurnId::new();
        let items = [
            edit(
                turn,
                ToolStatus::Done,
                "a.ts",
                Some("one\ntwo\nthree\n"),
                "one\n2\nthree\n",
            ),
            edit(
                turn,
                ToolStatus::Done,
                "a.ts",
                Some("one\n2\nthree\n"),
                "one\n2\nthree\nfour\n",
            ),
            edit(turn, ToolStatus::Done, "new.ts", None, "x\ny"),
            edit(turn, ToolStatus::Failed, "failed.ts", None, "1\n2\n3\n"),
            edit(turn, ToolStatus::Done, "back.ts", Some("1"), "2"),
            edit(turn, ToolStatus::Done, "back.ts", Some("2"), "1"),
        ];
        // a.ts: a line for another, then one more; new.ts: two new lines.
        assert_eq!(lines_of(&items, &[]), Some(changed(4, 1)));
        assert_eq!(lines_of(&items[4..], &[]), None, "a file changed back");
        assert_eq!(lines_of(&[], &[]), None, "no file changed");
        let empty = [edit(turn, ToolStatus::Done, "empty", None, "")];
        assert_eq!(lines_of(&empty, &[]), None, "no line changed");
    }

    #[test]
    fn a_turn_s_lines_count_its_sub_agents_edits_over_the_files_its_changes_show() {
        let ask = said("Fix it");
        let first = turn(ask.id);
        let done = |when, path: &str, old: Option<&str>, new: &str| {
            at(when, edit(first.id, ToolStatus::Done, path, old, new))
        };
        let own = done(5, "a.ts", Some("1\n2\n"), "1\n2\n3\n");
        let edits = [
            done(2, "a.ts", Some("0\n"), "1\n2\n"),
            done(6, "b.ts", None, "b\n"),
            at(7, edit(first.id, ToolStatus::Failed, "c.ts", None, "c\n")),
        ];
        // a.ts from before the sub-agent's edit to after the Agent's: "0"
        // for "1", "2" and "3"; b.ts: one new line; c.ts failed.
        let lines = lines_of(std::slice::from_ref(&own), &edits);
        assert_eq!(lines, Some(changed(4, 1)));
        let alone = lines_of(&[], &edits);
        assert_eq!(alone, Some(changed(3, 1)), "its edits alone");
        // The same files as the Thread's "Changed files" for that turn.
        let (_, files) = changes(
            &[ask, own],
            &edits,
            std::slice::from_ref(&first),
            Some(first.id),
        );
        let sum = files.iter().fold(changed(0, 0), |sum, file| {
            let one = counted(file.old.as_deref(), &file.new);
            changed(sum.added + one.added, sum.removed + one.removed)
        });
        assert_eq!(Some(sum), lines);
    }

    /// `apps/agents/changed-lines.json`: how many lines a change of a file
    /// added and removed, which the Thread's "Changed files" counts too.
    #[derive(Deserialize)]
    struct Cases {
        cases: Vec<Case>,
        many: Many,
    }

    #[derive(Deserialize)]
    struct Case {
        case: String,
        before: Option<String>,
        after: String,
        added: u32,
        removed: u32,
    }

    #[derive(Deserialize)]
    struct Many {
        case: String,
        lines: usize,
        added: u32,
        removed: u32,
    }

    #[test]
    fn a_file_counts_the_lines_the_thread_s_diff_counts() {
        let Cases { cases, many } =
            serde_json::from_str(include_str!("../../changed-lines.json")).unwrap();
        assert!(cases.len() >= 8, "the cases are there");
        for Case {
            case,
            before,
            after,
            added,
            removed,
        } in cases
        {
            let counted = counted(before.as_deref(), &after);
            assert_eq!(counted, changed(added, removed), "{case}");
        }
        let before: Vec<String> = (0..many.lines).map(|i| format!("line {i}")).collect();
        let after: Vec<String> = (0..many.lines)
            .map(|i| match i % 2 {
                0 => format!("line {i}"),
                _ => format!("changed {i}"),
            })
            .collect();
        let (before, after) = (before.join("\n"), after.join("\n"));
        let counted = counted(Some(&before), &after);
        assert_eq!(counted, changed(many.added, many.removed), "{}", many.case);
    }
}
