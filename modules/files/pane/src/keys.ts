/**
 * The keys of a Files Pane (ADR 0073, decision 3). The arrows are the
 * tree's own, as a list's are (ADR 0071, decision 1): ↑ ↓ move, ← folds
 * or goes to the folder above, → opens. These are the Pane's, with Ctrl
 * (⌘ on a Mac), as a Finder's: never the mod, which stays Banda's in
 * every Pane. Space is Quick Look, over the desk (step F3). F2 renames
 * in place, Ctrl+⌫ (or Delete) moves to the Trash, Ctrl+Z undoes, Ctrl+C,
 * X and V copy, cut and paste rows, Ctrl+D duplicates, Ctrl+N and
 * Ctrl+Shift+N make a file and a folder, and Ctrl+Shift+F finds words in
 * the files (step F5). Pure, so plain tests cover it.
 *
 * Until ADR 0071's scopes come (its step 3), they are the Pane's own, as
 * the browser's are; each also runs from an action, by its id, which
 * `keys.toml` can bind (`index.ts`).
 */
import { type Key, matches, type Pressed } from "@banda/ui/lib/keys"

/** What a Files Pane does on one of its keys. */
export type Does =
  | "open"
  | "peek"
  | "up"
  | "path"
  | "hidden"
  | "filter"
  | "rename"
  | "trash"
  | "undo"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "new-file"
  | "new-folder"
  | "search"

export const KEYS: readonly (Key & { does: Does })[] = [
  { code: "Enter", does: "open" },
  { code: "Space", does: "peek" },
  { code: "ArrowUp", primary: true, does: "up" },
  { code: "KeyL", primary: true, does: "path" },
  { code: "Period", primary: true, shift: true, does: "hidden" },
  { code: "Slash", does: "filter" },
  { code: "F2", does: "rename" },
  { code: "Backspace", primary: true, does: "trash" },
  { code: "Delete", does: "trash" },
  { code: "KeyZ", primary: true, does: "undo" },
  { code: "KeyC", primary: true, does: "copy" },
  { code: "KeyX", primary: true, does: "cut" },
  { code: "KeyV", primary: true, does: "paste" },
  { code: "KeyD", primary: true, does: "duplicate" },
  { code: "KeyN", primary: true, does: "new-file" },
  { code: "KeyN", primary: true, shift: true, does: "new-folder" },
  { code: "KeyF", primary: true, shift: true, does: "search" },
]

/** What the Pane does wherever the focus is in it, a field too; the
 * rest only where its tree has the keys, and the path and the hidden
 * files outside its fields. */
export const ANYWHERE: ReadonlySet<Does> = new Set(["path", "search"])
export const OUTSIDE_FIELDS: ReadonlySet<Does> = new Set(["up", "hidden"])

/** What a press does in a Files Pane; none for one that is not its. */
export function treeKey(pressed: Pressed): Does | undefined {
  return KEYS.find((key) => matches(pressed, key))?.does
}

/** The key that does `does`, for a tooltip. */
export function keyOf(does: Does): Key {
  return KEYS.find((key) => key.does === does) as Key
}

/** Whether a press types a letter or a number, which starts the filter
 * with it, as typing in a Finder's list finds. */
export function typesFilter(
  pressed: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">
): boolean {
  return (
    pressed.key.length === 1 &&
    /[\p{L}\p{N}._-]/u.test(pressed.key) &&
    !pressed.ctrlKey &&
    !pressed.metaKey &&
    !pressed.altKey
  )
}
