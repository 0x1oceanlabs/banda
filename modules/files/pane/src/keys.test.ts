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
  // The arrows alone are the tree's, Space is Quick Look's, and the mod's
  // keys are Banda's.
  expect(treeKey(press("ArrowUp"))).toBeUndefined()
  expect(treeKey(press("Space"))).toBeUndefined()
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
