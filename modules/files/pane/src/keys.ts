/**
 * The keys of a Files Pane (ADR 0073, decision 3). The arrows are the
 * tree's own, as a list's are (ADR 0071, decision 1): ↑ ↓ move, ← folds
 * or goes to the folder above, → opens. These are the Pane's, with Ctrl
 * (⌘ on a Mac), as a Finder's: never the mod, which stays Banda's in
 * every Pane. Space stays free for Quick Look (step F3). Pure, so plain
 * tests cover it.
 *
 * Until ADR 0071's scopes come (its step 3), they are the Pane's own, as
 * the browser's are; each also runs from an action, by its id, which
 * `keys.toml` can bind (`index.ts`).
 */
import { type Key, matches, type Pressed } from "@banda/ui/lib/keys"

/** What a Files Pane does on one of its keys. */
export type Does = "open" | "up" | "path" | "hidden" | "filter"

export const KEYS: readonly (Key & { does: Does })[] = [
  { code: "Enter", does: "open" },
  { code: "ArrowUp", primary: true, does: "up" },
  { code: "KeyL", primary: true, does: "path" },
  { code: "Period", primary: true, shift: true, does: "hidden" },
  { code: "Slash", does: "filter" },
]

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
