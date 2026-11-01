import { expect, test } from "vitest"
import { ACTIONS } from "../shell/actions"
import { matches } from "@banda/ui/lib/keys"
import { actionFor, keyName, rebind } from "./actions"

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
  const keys = ACTIONS.flatMap((action) => (action.keys ?? []).map(keyName))
  expect(new Set(keys).size).toBe(keys.length)
})

test("keys.toml binds a key to an action, frees one, and names a wrong one", () => {
  const bind = (text: string, code: string, action?: string, line = 2) => ({
    code,
    alt: true,
    shift: false,
    ctrl: false,
    action,
    text,
    line,
  })
  const { actions, problems } = rebind(ACTIONS, {
    file: "/c/keys.toml",
    binds: [
      bind("Alt+M", "KeyM", "column.maximize"),
      bind("Alt+W", "KeyW", "column.maximize", 3),
      bind("Alt+F", "KeyF", undefined, 4),
      bind("Alt+J", "KeyJ", "column.nothing", 5),
    ],
  })
  const run = (code: string) =>
    actionFor(actions, press(code, { altKey: true }))?.id
  // Its own key and the Person's both run it.
  expect(run("KeyM")).toBe("column.maximize")
  expect(run("KeyW")).toBe("column.maximize")
  // A freed key goes to the Pane, and so does an unknown action's.
  expect(run("KeyF")).toBeUndefined()
  expect(run("KeyJ")).toBeUndefined()
  expect(problems).toEqual([
    {
      path: "/c/keys.toml",
      line: 5,
      message: "Alt+J: Banda has no action column.nothing; Alt+K lists them",
    },
  ])
  // Nothing else changed.
  expect(actionFor(actions, press("KeyN", { altKey: true }))?.id).toBe(
    "pane.new"
  )
})

test("a plain letter is never the window's: it belongs to the Pane", () => {
  expect(actionFor(ACTIONS, press("KeyW"))).toBeUndefined()
  expect(actionFor(ACTIONS, press("KeyW", { ctrlKey: true }))).toBeUndefined()
  expect(actionFor(ACTIONS, press("KeyW", { altKey: true }))?.id).toBe(
    "pane.close"
  )
})
