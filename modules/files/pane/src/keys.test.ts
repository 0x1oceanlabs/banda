import { isMac, type Key, matches } from "@banda/ui/lib/keys"
import { expect, test } from "vitest"
import { type Does, idOf, KEYS, takes, typesFilter } from "./keys"

const press = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})

/** What a press does in a Files Pane, by Banda's keys. */
const doing = (pressed: ReturnType<typeof press>): Does | undefined =>
  KEYS.find(({ keys }) => keys.some((key) => matches(pressed, key, false)))
    ?.does

test("each key is an action of its own, with an id keys.toml binds", () => {
  const ids = KEYS.map(({ id }) => id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.every((id) => id.startsWith("files."))).toBe(true)
  expect(idOf("rename")).toBe("files.rename-picked")
  expect(idOf("peek")).toBe("files.peek")
  expect(idOf("columns")).toBe("files.view-columns")
  // No two actions share a key, in the one scope.
  const all: Key[] = KEYS.flatMap(({ keys }) => keys)
  const named = all.map((key) => JSON.stringify(key))
  expect(new Set(named).size).toBe(named.length)
})

test("the Pane's keys are its own, plain or with Ctrl, never the mod", () => {
  for (const { keys } of KEYS)
    for (const key of keys) {
      expect(key.mod ?? false).toBe(false)
      expect(key.more ?? false).toBe(false)
      expect(key.alt ?? false).toBe(false)
    }
  expect(doing(press("Enter"))).toBe("open")
  expect(doing(press("ArrowUp", { ctrlKey: true }))).toBe("up")
  expect(doing(press("KeyL", { ctrlKey: true }))).toBe("path")
  expect(doing(press("Period", { ctrlKey: true, shiftKey: true }))).toBe(
    "hidden"
  )
  expect(doing(press("Slash"))).toBe("filter")
  // Space is Quick Look's (ADR 0073, decision 7).
  expect(doing(press("Space"))).toBe("peek")
  // The arrows alone are the views' own, and the mod's keys are Banda's.
  expect(doing(press("ArrowUp"))).toBeUndefined()
  expect(doing(press("Space", { altKey: true }))).toBeUndefined()
  expect(doing(press("KeyL", { altKey: true }))).toBeUndefined()
})

test("the operations' keys are the Pane's own, with Ctrl as a Finder's ⌘", () => {
  expect(doing(press("F2"))).toBe("rename")
  expect(doing(press("Backspace", { ctrlKey: true }))).toBe("trash")
  expect(doing(press("Delete"))).toBe("trash")
  expect(doing(press("KeyZ", { ctrlKey: true }))).toBe("undo")
  expect(doing(press("KeyC", { ctrlKey: true }))).toBe("copy")
  expect(doing(press("KeyX", { ctrlKey: true }))).toBe("cut")
  expect(doing(press("KeyV", { ctrlKey: true }))).toBe("paste")
  expect(doing(press("KeyD", { ctrlKey: true }))).toBe("duplicate")
  expect(doing(press("KeyN", { ctrlKey: true }))).toBe("new-file")
  expect(doing(press("KeyN", { ctrlKey: true, shiftKey: true }))).toBe(
    "new-folder"
  )
  expect(doing(press("KeyF", { ctrlKey: true, shiftKey: true }))).toBe("search")
  // A plain Backspace is the filter's; the mod's keys are Banda's.
  expect(doing(press("Backspace"))).toBeUndefined()
  expect(doing(press("KeyZ", { altKey: true }))).toBeUndefined()
})

test("Ctrl+1, 2 and 3 show a list, columns and a gallery; Ctrl+I the info", () => {
  expect(doing(press("Digit1", { ctrlKey: true }))).toBe("list")
  expect(doing(press("Digit2", { ctrlKey: true }))).toBe("columns")
  expect(doing(press("Digit3", { ctrlKey: true }))).toBe("gallery")
  expect(doing(press("KeyI", { ctrlKey: true }))).toBe("info")
  // ⌘ on a Mac.
  const keys = KEYS.find(({ does }) => does === "columns")?.keys ?? []
  expect(
    keys.some((key) => matches(press("Digit2", { metaKey: true }), key, true))
  ).toBe(true)
  expect(isMac).toBe(false)
})

test("a key is the Pane's in its view; in a field only Ctrl+L and Ctrl+Shift+F are", () => {
  const view = { field: false, view: true }
  const field = { field: true, view: false }
  const header = { field: false, view: false }
  expect(takes("rename", view)).toBe(true)
  expect(takes("peek", view)).toBe(true)
  // A field keeps its own: Space types, Ctrl+Z undoes its text.
  expect(takes("peek", field)).toBe(false)
  expect(takes("undo", field)).toBe(false)
  expect(takes("columns", field)).toBe(false)
  expect(takes("path", field)).toBe(true)
  expect(takes("search", field)).toBe(true)
  // Outside its view and its fields, as on a header's button, the
  // Pane's own switches still work; a row's do not.
  expect(takes("hidden", header)).toBe(true)
  expect(takes("gallery", header)).toBe(true)
  expect(takes("info", header)).toBe(true)
  expect(takes("trash", header)).toBe(false)
})

test("a letter starts the filter; a key with Ctrl or the mod does not", () => {
  const typed = (key: string, mods: Partial<KeyboardEvent> = {}) =>
    typesFilter({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods })
  expect(typed("m")).toBe(true)
  expect(typed("Ж")).toBe(true)
  expect(typed("4")).toBe(true)
  expect(typed(" ")).toBe(false)
  expect(typed("ArrowDown")).toBe(false)
  expect(typed("m", { ctrlKey: true })).toBe(false)
  expect(typed("m", { altKey: true })).toBe(false)
})
