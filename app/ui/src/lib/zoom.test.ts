import { expect, test } from "vitest"
import { zoomAfter } from "./zoom"

const press = (code: string, held: Partial<KeyboardEvent> = {}) => ({
  code,
  altKey: false,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  ...held,
})

test("Ctrl or ⌘ with + − 0 zooms in, out and back, a browser's steps", () => {
  expect(zoomAfter(press("Equal"), 1)).toBe(1.1)
  expect(zoomAfter(press("Equal", { shiftKey: true }), 1.1)).toBe(1.25)
  const command = { ctrlKey: false, metaKey: true }
  expect(zoomAfter(press("Minus", command), 1)).toBe(0.9)
  expect(zoomAfter(press("Digit0"), 1.75)).toBe(1)
})

test("a zoom stays at either end", () => {
  expect(zoomAfter(press("Equal"), 2)).toBe(2)
  expect(zoomAfter(press("Minus"), 0.5)).toBe(0.5)
})

test("other keys, or with Alt or no Ctrl, do not zoom", () => {
  expect(zoomAfter(press("KeyC"), 1)).toBeNull()
  expect(zoomAfter(press("Equal", { ctrlKey: false }), 1)).toBeNull()
  expect(zoomAfter(press("Equal", { altKey: true }), 1)).toBeNull()
  expect(zoomAfter(press("Minus", { shiftKey: true }), 1)).toBeNull()
})
