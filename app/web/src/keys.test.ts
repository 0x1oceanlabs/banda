import { expect, test } from "vitest"
import { keyAction } from "./keys"

const press = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) =>
  keyAction({
    key,
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  })

test("the Desk's keys, in any keyboard layout, and nothing else", () => {
  expect(press("ArrowLeft", "ArrowLeft", { altKey: true })).toEqual({
    do: "move",
    direction: "left",
  })
  expect(press("\\", "Backslash", { ctrlKey: true })).toEqual({
    do: "split",
    place: "right",
  })
  expect(press("|", "Backslash", { ctrlKey: true, shiftKey: true })).toEqual({
    do: "split",
    place: "below",
  })
  expect(press("w", "KeyW", { metaKey: true })).toEqual({ do: "close" })
  expect(press("ц", "KeyW", { ctrlKey: true })).toEqual({ do: "close" })
  expect(press("ArrowLeft", "ArrowLeft")).toBeNull()
  expect(press("w", "KeyW")).toBeNull()
  expect(press("a", "KeyA", { ctrlKey: true })).toBeNull()
})
