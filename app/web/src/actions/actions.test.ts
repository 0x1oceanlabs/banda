import { expect, test } from "vitest"
import { ACTIONS } from "../shell/actions"
import { actionFor, keyName, matches } from "./actions"

const press = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
})

test("a key matches only with exactly its mods held", () => {
  const key = { code: "KeyW", alt: true }
  expect(matches(press("KeyW", { altKey: true }), key)).toBe(true)
  expect(matches(press("KeyW"), key)).toBe(false)
  expect(matches(press("KeyW", { altKey: true, shiftKey: true }), key)).toBe(
    false
  )
})

test("⌘ counts as Ctrl", () => {
  const key = { code: "ArrowLeft", alt: true, ctrl: true }
  expect(
    matches(press("ArrowLeft", { altKey: true, metaKey: true }), key)
  ).toBe(true)
})

test("a key reads as a Person writes it", () => {
  expect(keyName({ code: "Digit3", alt: true, shift: true })).toBe(
    "Alt+Shift+3"
  )
  expect(keyName({ code: "Enter", alt: true })).toBe("Alt+Return")
})

test("the window's actions each have their own name and key", () => {
  const ids = ACTIONS.map((action) => action.id)
  expect(new Set(ids).size).toBe(ids.length)
  const keys = ACTIONS.flatMap((action) =>
    action.key ? [keyName(action.key)] : []
  )
  expect(new Set(keys).size).toBe(keys.length)
})

test("a plain letter is never the window's: it belongs to the Pane", () => {
  expect(actionFor(ACTIONS, press("KeyW"))).toBeUndefined()
  expect(actionFor(ACTIONS, press("KeyW", { ctrlKey: true }))).toBeUndefined()
  expect(actionFor(ACTIONS, press("KeyW", { altKey: true }))?.id).toBe(
    "pane.close"
  )
})
