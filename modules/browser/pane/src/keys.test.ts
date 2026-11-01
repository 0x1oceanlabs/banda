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
  expect(browserKey(key("BracketLeft", { metaKey: true }))).toBe("back")
  expect(browserKey(key("F12"))).toBe("devtools")
  expect(browserKey(key("KeyL"))).toBeUndefined()
  expect(browserKey(key("KeyC", { ctrlKey: true }))).toBeUndefined()
})

test("the window takes Alt keys and the browser's; the page keeps the rest", () => {
  expect(taken(key("ArrowLeft", { altKey: true }))).toBe(true)
  expect(taken(key("KeyR", { ctrlKey: true }))).toBe(true)
  expect(taken(key("AltLeft", { altKey: true }))).toBe(false)
  expect(taken(key("KeyC", { ctrlKey: true }))).toBe(false)
  expect(taken(key("KeyA"))).toBe(false)
})
