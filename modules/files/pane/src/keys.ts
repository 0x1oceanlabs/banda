/**
 * The keys of a Files Pane (ADR 0073, decision 3), each an action of its
 * scope, `files`, its whole tile (ADR 0071, decision 1): the window
 * matches them, `keys.toml` moves them in `[binds.files]`, and the key
 * sheet lists them. The arrows are the views' own, as a list's are: ↑ ↓
 * move, ← and → fold and open in the tree, and go between columns or
 * along the filmstrip. These are the Pane's, with Ctrl (⌘ on a Mac), as a
 * Finder's: never the mod, which stays Banda's in every Pane.
 *
 * ↵ opens and Space is Quick Look, over the desk (step F3). F2 renames in
 * place, Ctrl+⌫ (or Delete) moves to the Trash, Ctrl+Z undoes, Ctrl+C, X
 * and V copy, cut and paste rows, Ctrl+D duplicates, Ctrl+N and
 * Ctrl+Shift+N make a file and a folder, and Ctrl+Shift+F finds words in
 * the files (step F5). Ctrl+1, 2 and 3 show the folder as a list, columns
 * or a gallery, and Ctrl+I shows the info of the row picked (step F6).
 * Pure, so plain tests cover it.
 */
import type { Key } from "@banda/ui/lib/keys"

/** The scope of a Files Pane's own keys: its tile. */
export const FILES = "files"

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
  | "list"
  | "columns"
  | "gallery"
  | "info"

/** Each key's action: what it does, its id for `keys.toml`, its title
 * in the key sheet, and Banda's keys for it. */
export const KEYS: readonly {
  does: Does
  id: string
  title: string
  keys: readonly Key[]
}[] = [
  {
    does: "open",
    id: "files.open-picked",
    title: "Open the file picked, or go into the folder",
    keys: [{ code: "Enter" }],
  },
  // Quick Look's action takes a file too, as a reply's path menu asks
  // (`index.ts`).
  {
    does: "peek",
    id: "files.peek",
    title: "Quick Look",
    keys: [{ code: "Space" }],
  },
  {
    does: "up",
    id: "files.up",
    title: "Go to the folder above",
    keys: [{ code: "ArrowUp", primary: true }],
  },
  {
    does: "path",
    id: "files.path",
    title: "Type a path",
    keys: [{ code: "KeyL", primary: true }],
  },
  {
    does: "hidden",
    id: "files.hidden",
    title: "Show hidden files, or hide them",
    keys: [{ code: "Period", primary: true, shift: true }],
  },
  {
    does: "filter",
    id: "files.filter",
    title: "Filter the files",
    keys: [{ code: "Slash" }],
  },
  {
    does: "rename",
    id: "files.rename-picked",
    title: "Rename the files picked",
    keys: [{ code: "F2" }],
  },
  {
    does: "trash",
    id: "files.trash-picked",
    title: "Move the files picked to the Trash",
    keys: [{ code: "Backspace", primary: true }, { code: "Delete" }],
  },
  {
    does: "undo",
    id: "files.undo",
    title: "Undo what Files did last",
    keys: [{ code: "KeyZ", primary: true }],
  },
  {
    does: "copy",
    id: "files.copy-picked",
    title: "Copy the files picked",
    keys: [{ code: "KeyC", primary: true }],
  },
  {
    does: "cut",
    id: "files.cut-picked",
    title: "Cut the files picked",
    keys: [{ code: "KeyX", primary: true }],
  },
  {
    does: "paste",
    id: "files.paste",
    title: "Paste the files copied or cut",
    keys: [{ code: "KeyV", primary: true }],
  },
  {
    does: "duplicate",
    id: "files.duplicate-picked",
    title: "Duplicate the files picked",
    keys: [{ code: "KeyD", primary: true }],
  },
  {
    does: "new-file",
    id: "files.new-file",
    title: "Make a file",
    keys: [{ code: "KeyN", primary: true }],
  },
  {
    does: "new-folder",
    id: "files.new-folder",
    title: "Make a folder",
    keys: [{ code: "KeyN", primary: true, shift: true }],
  },
  {
    does: "search",
    id: "files.find-in-files",
    title: "Find words in the files",
    keys: [{ code: "KeyF", primary: true, shift: true }],
  },
  {
    does: "list",
    id: "files.view-list",
    title: "Show the folder as a list",
    keys: [{ code: "Digit1", primary: true }],
  },
  {
    does: "columns",
    id: "files.view-columns",
    title: "Show the folder as columns",
    keys: [{ code: "Digit2", primary: true }],
  },
  {
    does: "gallery",
    id: "files.view-gallery",
    title: "Show the folder as a gallery",
    keys: [{ code: "Digit3", primary: true }],
  },
  {
    does: "info",
    id: "files.show-info",
    title: "Show the info of the file picked, or hide it",
    keys: [{ code: "KeyI", primary: true }],
  },
]

/** The id of the action that does `does`, for its key in force. */
export function idOf(does: Does): string {
  return (KEYS.find((key) => key.does === does) as (typeof KEYS)[number]).id
}

/** What the Pane does wherever the focus is in it, a field too; and
 * outside its fields. The rest only where its view has the keys. */
const ANYWHERE: ReadonlySet<Does> = new Set(["path", "search"])
const OUTSIDE_FIELDS: ReadonlySet<Does> = new Set([
  "up",
  "hidden",
  "list",
  "columns",
  "gallery",
  "info",
])

/** Whether a Files Pane takes a key that does `does`, pressed in one of
 * its fields, or in its view of the folder; one that is not taken is the
 * field's, as Ctrl+Z in the filter. */
export function takes(
  does: Does,
  at: { field: boolean; view: boolean }
): boolean {
  return (
    ANYWHERE.has(does) || (!at.field && (OUTSIDE_FIELDS.has(does) || at.view))
  )
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
