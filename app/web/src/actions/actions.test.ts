import { DEFAULT_KEYS } from "@banda/contract/look"
import { expect, test } from "vitest"
import { ACTIONS } from "../shell/actions"
import { keyText, matches } from "@banda/ui/lib/keys"
import type { Mod } from "@banda/contract/look"
import { actionFor, movesOf, rebind, RESET_KEY } from "./actions"

/** Banda's actions with its own keys, Alt the mod. */
const BANDA = rebind(ACTIONS, DEFAULT_KEYS).actions

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
  // The reset chord is its own action's, as look/src/keys.rs names it.
  expect(keyText(RESET_KEY)).toBe("Ctrl+Alt+Shift+K")
  expect(
    actionFor(
      BANDA,
      press("KeyK", { altKey: true, ctrlKey: true, shiftKey: true })
    )?.id
  ).toBe("keys.reset")
})

test("keys.toml binds a key to an action, frees one, and names a wrong one", () => {
  const bind = (text: string, code: string, action?: string, line = 2) => ({
    code,
    alt: true,
    shift: false,
    ctrl: false,
    super: false,
    action,
    text,
    line,
  })
  const { actions, problems } = rebind(ACTIONS, {
    ...DEFAULT_KEYS,
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
      message:
        "Alt+J: Banda has no action column.nothing; the key sheet lists them",
    },
  ])
  // Nothing else changed.
  expect(actionFor(actions, press("KeyN", { altKey: true }))?.id).toBe(
    "pane.new"
  )
})

test("a bind to an action's old id runs it, and says its name now", () => {
  const { actions, problems } = rebind(ACTIONS, {
    ...DEFAULT_KEYS,
    file: "/c/keys.toml",
    binds: [
      {
        code: "KeyY",
        alt: true,
        shift: false,
        super: false,
        ctrl: false,
        action: "sidebar.settle",
        text: "Alt+Y",
        line: 2,
      },
    ],
  })
  expect(actionFor(actions, press("KeyY", { altKey: true }))?.id).toBe(
    "sidebar.archive"
  )
  expect(problems).toEqual([
    {
      path: "/c/keys.toml",
      line: 2,
      message: "Alt+Y: sidebar.settle is called sidebar.archive now",
    },
  ])
})

test("a plain letter is never the window's: it belongs to the Pane", () => {
  expect(actionFor(BANDA, press("KeyW"))).toBeUndefined()
  expect(actionFor(BANDA, press("KeyW", { ctrlKey: true }))).toBeUndefined()
  expect(actionFor(BANDA, press("KeyW", { altKey: true }))?.id).toBe(
    "pane.close"
  )
})

test("New terminal has its own key, and keys.toml can replace or free it", () => {
  const enter = press("Enter", { ctrlKey: true, altKey: true })
  expect(actionFor(BANDA, enter)?.id).toBe("terminal.new")

  const { actions, problems } = rebind(ACTIONS, {
    ...DEFAULT_KEYS,
    file: "/c/keys.toml",
    binds: [
      {
        code: "Enter",
        ctrl: true,
        alt: true,
        shift: false,
        super: false,
        text: "Ctrl+Alt+Return",
        line: 2,
      },
      {
        code: "KeyT",
        ctrl: true,
        alt: true,
        shift: false,
        super: false,
        text: "Ctrl+Alt+T",
        action: "terminal.new",
        line: 3,
      },
    ],
  })
  expect(problems).toEqual([])
  expect(actionFor(actions, enter)).toBeUndefined()
  expect(
    actionFor(actions, press("KeyT", { ctrlKey: true, altKey: true }))?.id
  ).toBe("terminal.new")
})

test("Banda's keys move with the mod, as its levels say, and none clash", () => {
  const keyOf = (mod: Mod, id: string) =>
    rebind(ACTIONS, { ...DEFAULT_KEYS, mod }).actions.find(
      (action) => action.id === id
    )?.keys?.[0]
  const ctrlAlt: Mod = { alt: true, ctrl: true, super: false }
  const altSuper: Mod = { alt: true, ctrl: false, super: true }
  expect(keyText(keyOf(ctrlAlt, "column.next-width")!)).toBe("Ctrl+Alt+R")
  expect(keyText(keyOf(ctrlAlt, "pane.send-2")!)).toBe("Ctrl+Alt+Shift+2")
  // One more: the first of Ctrl, Super and Alt that the mod lacks.
  expect(keyText(keyOf(ctrlAlt, "column.wider")!)).toBe("Ctrl+Alt+Super+Right")
  expect(keyText(keyOf(DEFAULT_KEYS.mod, "column.wider")!)).toBe(
    "Ctrl+Alt+Right"
  )
  expect(keyText(keyOf(altSuper, "terminal.new")!)).toBe(
    "Ctrl+Alt+Super+Return"
  )
  // The reset is no mod's.
  expect(keyText(keyOf(ctrlAlt, "keys.reset")!)).toBe("Ctrl+Alt+Shift+K")
  // Each mod there may be: none makes two actions share a key.
  for (const mod of [
    DEFAULT_KEYS.mod,
    ctrlAlt,
    altSuper,
    { alt: false, ctrl: false, super: true },
    { alt: false, ctrl: true, super: true },
  ])
    expect(rebind(ACTIONS, { ...DEFAULT_KEYS, mod }).problems).toEqual([])
})

test("two actions on one key with the mod are named at its line", () => {
  const { actions, problems } = rebind(
    [
      {
        id: "a.one",
        title: "One",
        section: "A",
        keys: [{ code: "KeyX", mod: true }],
        run: () => {},
      },
      {
        id: "a.two",
        title: "Two",
        section: "A",
        keys: [{ code: "KeyX", ctrl: true, alt: true }],
        run: () => {},
      },
    ],
    {
      ...DEFAULT_KEYS,
      file: "/c/keys.toml",
      mod: { alt: true, ctrl: true, super: false },
      modLine: 3,
    }
  )
  expect(actions.map((action) => action.keys?.length)).toEqual([1, 0])
  expect(problems).toEqual([
    {
      path: "/c/keys.toml",
      line: 3,
      message: "Ctrl+Alt+X is “One” and “Two” with this mod; “One” keeps it",
    },
  ])
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

test("a none of a mod not in force frees nothing, and is named", () => {
  const { problems } = rebind(ACTIONS, {
    ...DEFAULT_KEYS,
    file: "/c/keys.toml",
    mod: { alt: true, ctrl: true, super: false },
    binds: [
      {
        code: "KeyF",
        alt: true,
        shift: false,
        ctrl: false,
        super: false,
        text: "Alt+F",
        line: 4,
      },
    ],
  })
  expect(problems).toEqual([
    {
      path: "/c/keys.toml",
      line: 4,
      message: "Alt+F: no Banda key is here with this mod, so it frees nothing",
    },
  ])
})
