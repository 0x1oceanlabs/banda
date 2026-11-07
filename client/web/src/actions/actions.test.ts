import { expect, test } from "vitest"
import { ACTIONS } from "../shell/actions"
import { keyText, matches } from "@banda/ui/lib/keys"
import type { Mod } from "@banda/contract/look"
import { actionFor, movesOf, pressFor, RESET_KEY, withKeys } from "./actions"
import type { Action } from "@banda/ui/module"

/** Banda's actions with its own keys, Alt the mod, before the look. */
const BANDA = withKeys(ACTIONS, [])

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

test("a primary key is Ctrl, or ⌘ too on a Mac; any other is exact", () => {
  const tab = { code: "KeyT", primary: true }
  const command = press("KeyT", { metaKey: true })
  expect(matches(command, tab, true)).toBe(true)
  expect(matches(press("KeyT", { ctrlKey: true }), tab, true)).toBe(true)
  // Elsewhere Super is never Ctrl, and Ctrl is never ⌘.
  expect(matches(command, tab, false)).toBe(false)
  expect(matches(command, { code: "KeyT", ctrl: true }, true)).toBe(false)
  expect(matches(command, { code: "KeyT", super: true }, true)).toBe(true)
})

test("every action, a module's or the window's, has its own id and key", () => {
  const ids = ACTIONS.map((action) => action.id)
  expect(new Set(ids).size).toBe(ids.length)
  // The reset chord is its own action's, as platform/look/src/keys.rs names it.
  expect(keyText(RESET_KEY)).toBe("Ctrl+Alt+Shift+K")
  expect(
    actionFor(
      BANDA,
      press("KeyK", { altKey: true, ctrlKey: true, shiftKey: true })
    )?.id
  ).toBe("keys.reset")
})

test("a plain letter is never the window's: it belongs to the Pane", () => {
  expect(actionFor(BANDA, press("KeyW"))).toBeUndefined()
  expect(actionFor(BANDA, press("KeyW", { ctrlKey: true }))).toBeUndefined()
  expect(actionFor(BANDA, press("KeyW", { altKey: true }))?.id).toBe(
    "pane.close"
  )
})

test("a new mod moves the lines that held the old one, at their level", () => {
  const line = (
    text: string,
    code: string,
    held: Partial<Mod>,
    action?: string
  ) => ({
    code,
    alt: false,
    ctrl: false,
    super: false,
    shift: false,
    ...held,
    action,
    text,
    line: 2,
  })
  const alt: Mod = { alt: true, ctrl: false, super: false }
  const ctrlAlt: Mod = { alt: true, ctrl: true, super: false }
  const moves = movesOf(
    [
      line("Alt+M", "KeyM", { alt: true }, "column.maximize"),
      line("Ctrl+Alt+T", "KeyT", { alt: true, ctrl: true }, "terminal.new"),
      line("Alt+F", "KeyF", { alt: true }),
      line("Ctrl+J", "KeyJ", { ctrl: true }, "pane.close"),
    ],
    alt,
    ctrlAlt
  )
  expect(moves.map(({ bind, to }) => [bind.text, to && keyText(to)])).toEqual([
    ["Alt+M", "Ctrl+Alt+M"],
    ["Ctrl+Alt+T", "Ctrl+Alt+Super+T"],
    ["Alt+F", undefined],
  ])
})

test("the keys in force are the look's, each with what it gives its action", () => {
  const actions = withKeys(ACTIONS, [
    {
      id: "browser.open",
      keys: [
        {
          code: "KeyH",
          alt: true,
          ctrl: true,
          super: false,
          shift: false,
          primary: false,
          args: { address: "https://github.com" },
          line: 3,
        },
      ],
    },
  ])
  const pressed = pressFor(
    actions,
    press("KeyH", { ctrlKey: true, altKey: true })
  )
  expect(pressed?.action.id).toBe("browser.open")
  expect(pressed?.args).toEqual({ address: "https://github.com" })
  // What the look leaves out has no key.
  expect(actionFor(actions, press("KeyW", { altKey: true }))).toBeUndefined()
})

test("a scope's key works with the mod still held, unless the window's takes it", () => {
  const launcher = (code: string): Action<null> => ({
    id: `launcher.${code}`,
    title: code,
    section: "Launcher",
    scope: "launcher",
    keys: [{ code, args: { kind: code } }],
    run: () => undefined,
  })
  const window: Action<null> = {
    id: "deck",
    title: "Deck",
    section: "Columns",
    keys: [{ code: "KeyT", alt: true }],
    run: () => undefined,
  }
  const actions = [launcher("KeyB"), launcher("KeyT"), window]
  const alt = { alt: true, ctrl: false, super: false }
  const held = { mod: alt, scopes: new Set(["launcher"]) }
  const id = (code: string, scopes: string[], given?: typeof held) =>
    pressFor(actions, press(code, { altKey: true }), scopes, given)?.action.id
  expect(id("KeyB", ["launcher"], held)).toBe("launcher.KeyB")
  // Alt+T is the window's, the launcher focused or not.
  expect(id("KeyT", ["launcher"], held)).toBe("deck")
  // Out of the launcher, or with no scope that takes it so, Alt+B is no key.
  expect(id("KeyB", [], held)).toBeUndefined()
  expect(id("KeyB", ["launcher"])).toBeUndefined()
})
