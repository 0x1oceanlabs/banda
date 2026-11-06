import { expect, test } from "vitest"
import { treeKey, typesFilter } from "./keys"

const press = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})

test("the Pane's keys are its own, with Ctrl, never the mod", () => {
  expect(treeKey(press("Enter"))).toBe("open")
  expect(treeKey(press("ArrowUp", { ctrlKey: true }))).toBe("up")
  expect(treeKey(press("KeyL", { ctrlKey: true }))).toBe("path")
  expect(treeKey(press("Period", { ctrlKey: true, shiftKey: true }))).toBe(
    "hidden"
  )
  expect(treeKey(press("Slash"))).toBe("filter")
  // Space is Quick Look's (ADR 0073, decision 7).
  expect(treeKey(press("Space"))).toBe("peek")
  // The arrows alone are the tree's, and the mod's keys are Banda's: Alt
  // and Space is the Banda menu's.
  expect(treeKey(press("ArrowUp"))).toBeUndefined()
  expect(treeKey(press("Space", { altKey: true }))).toBeUndefined()
  expect(treeKey(press("ArrowUp", { altKey: true }))).toBeUndefined()
  expect(treeKey(press("KeyL", { altKey: true }))).toBeUndefined()
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

test("the operations' keys are the tree's own, with Ctrl as a Finder's ⌘", () => {
  expect(treeKey(press("F2"))).toBe("rename")
  expect(treeKey(press("Backspace", { ctrlKey: true }))).toBe("trash")
  expect(treeKey(press("Delete"))).toBe("trash")
  expect(treeKey(press("KeyZ", { ctrlKey: true }))).toBe("undo")
  expect(treeKey(press("KeyC", { ctrlKey: true }))).toBe("copy")
  expect(treeKey(press("KeyX", { ctrlKey: true }))).toBe("cut")
  expect(treeKey(press("KeyV", { ctrlKey: true }))).toBe("paste")
  expect(treeKey(press("KeyD", { ctrlKey: true }))).toBe("duplicate")
  expect(treeKey(press("KeyN", { ctrlKey: true }))).toBe("new-file")
  expect(treeKey(press("KeyN", { ctrlKey: true, shiftKey: true }))).toBe(
    "new-folder"
  )
  expect(treeKey(press("KeyF", { ctrlKey: true, shiftKey: true }))).toBe(
    "search"
  )
  // A plain Backspace is the filter's; the mod's keys are Banda's.
  expect(treeKey(press("Backspace"))).toBeUndefined()
  expect(treeKey(press("KeyZ", { altKey: true }))).toBeUndefined()
})
