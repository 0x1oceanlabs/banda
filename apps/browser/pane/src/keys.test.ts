import { expect, test } from "vitest"
import { type Key, matches } from "@banda/ui/lib/keys"
import { BROWSER_KEYS, type Does, taken } from "./keys"

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

/** What a press does in the browser, off a Mac. */
const doesOf = (pressed: ReturnType<typeof key>): Does | undefined =>
  BROWSER_KEYS.find((one) => one.keys.some((it) => matches(pressed, it, false)))
    ?.does

test("the browser's keys are Chrome's, with Ctrl", () => {
  expect(doesOf(key("KeyL", { ctrlKey: true }))).toBe("address")
  expect(doesOf(key("KeyR", { ctrlKey: true, shiftKey: true }))).toBe(
    "reload-hard"
  )
  expect(doesOf(key("BracketLeft", { ctrlKey: true }))).toBe("back")
  // ⌘ does it on a Mac; elsewhere Super is not Ctrl.
  expect(doesOf(key("BracketLeft", { metaKey: true }))).toBeUndefined()
  expect(doesOf(key("F12"))).toBe("devtools")
  expect(doesOf(key("KeyT", { ctrlKey: true }))).toBe("tab-new")
  expect(doesOf(key("KeyT", { ctrlKey: true, shiftKey: true }))).toBe(
    "tab-reopen"
  )
  expect(doesOf(key("KeyW", { ctrlKey: true }))).toBe("tab-close")
  expect(doesOf(key("Tab", { ctrlKey: true, shiftKey: true }))).toBe(
    "tab-previous"
  )
  expect(doesOf(key("Digit9", { ctrlKey: true }))).toBe("tab-9")
  expect(doesOf(key("KeyL"))).toBeUndefined()
  expect(doesOf(key("KeyC", { ctrlKey: true }))).toBeUndefined()
})

test("the window takes the keys in force from a page; the page keeps the rest", () => {
  const inForce: Key[] = [
    { code: "ArrowLeft", alt: true },
    { code: "KeyW", alt: true, ctrl: true },
    { code: "KeyR", primary: true },
  ]
  expect(taken(key("ArrowLeft", { altKey: true }), inForce)).toBe(true)
  expect(taken(key("KeyR", { ctrlKey: true }), inForce)).toBe(true)
  // ⌘ is Ctrl's on a Mac.
  expect(taken(key("KeyR", { metaKey: true }), inForce, true)).toBe(true)
  expect(taken(key("AltLeft", { altKey: true }), inForce)).toBe(false)
  expect(taken(key("KeyC", { ctrlKey: true }), inForce)).toBe(false)
  expect(taken(key("KeyA"), inForce)).toBe(false)
  // An Alt key no action has, as one keys.toml freed, is the page's.
  expect(taken(key("KeyF", { altKey: true }), inForce)).toBe(false)
  expect(taken(key("KeyW", { altKey: true }), inForce)).toBe(false)
  expect(taken(key("KeyW", { altKey: true, ctrlKey: true }), inForce)).toBe(
    true
  )
})
