import { expect, test } from "vitest"
import { browserKey, taken } from "./keys"

const key = (
  code: string,
  mods: Partial<
    Record<"altKey" | "ctrlKey" | "shiftKey" | "metaKey", boolean>
  > = {}
) => ({
  code,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

test("the browser's keys are Chrome's, with Ctrl", () => {
  expect(browserKey(key("KeyL", { ctrlKey: true }))).toBe("address")
  expect(browserKey(key("KeyR", { ctrlKey: true, shiftKey: true }))).toBe(
    "reload-hard"
  )
  expect(browserKey(key("BracketLeft", { ctrlKey: true }))).toBe("back")
  // ⌘ does it on a Mac; elsewhere Super is not Ctrl.
  expect(browserKey(key("BracketLeft", { metaKey: true }))).toBeUndefined()
  expect(browserKey(key("F12"))).toBe("devtools")
  expect(browserKey(key("KeyT", { ctrlKey: true }))).toBe("tab-new")
  expect(browserKey(key("KeyT", { ctrlKey: true, shiftKey: true }))).toBe(
    "tab-reopen"
  )
  expect(browserKey(key("KeyW", { ctrlKey: true }))).toBe("tab-close")
  expect(browserKey(key("Tab", { ctrlKey: true, shiftKey: true }))).toBe(
    "tab-previous"
  )
  expect(browserKey(key("Digit9", { ctrlKey: true }))).toBe("tab-9")
  expect(browserKey(key("KeyL"))).toBeUndefined()
  expect(browserKey(key("KeyC", { ctrlKey: true }))).toBeUndefined()
})

test("the window takes the mod's keys and the browser's; the page keeps the rest", () => {
  const alt = { alt: true, ctrl: false, super: false }
  expect(taken(key("ArrowLeft", { altKey: true }), alt)).toBe(true)
  expect(taken(key("KeyR", { ctrlKey: true }), alt)).toBe(true)
  expect(taken(key("AltLeft", { altKey: true }), alt)).toBe(false)
  expect(taken(key("KeyC", { ctrlKey: true }), alt)).toBe(false)
  expect(taken(key("KeyA"), alt)).toBe(false)
  // With Ctrl+Alt the mod, Alt alone is the page's.
  const ctrlAlt = { alt: true, ctrl: true, super: false }
  expect(taken(key("KeyW", { altKey: true }), ctrlAlt)).toBe(false)
  expect(taken(key("KeyW", { altKey: true, ctrlKey: true }), ctrlAlt)).toBe(
    true
  )
})
