import { expect, test } from "vitest"
import { keyAction } from "./keys"

const press = (
  key: string,
  code: string,
  mods: Partial<KeyboardEvent> = {},
  program = false
) =>
  keyAction(
    {
      key,
      code,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...mods,
    },
    program
  )

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

test("in a terminal, Ctrl+W is the program's and Ctrl+Shift+W closes the tile", () => {
  expect(press("w", "KeyW", { ctrlKey: true }, true)).toBeNull()
  expect(press("W", "KeyW", { ctrlKey: true, shiftKey: true }, true)).toEqual({
    do: "close",
  })
  expect(press("W", "KeyW", { ctrlKey: true, shiftKey: true })).toBeNull()
  expect(press("ArrowLeft", "ArrowLeft", { altKey: true }, true)).toEqual({
    do: "move",
    direction: "left",
  })
})
