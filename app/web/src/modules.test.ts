import { expect, test } from "vitest"
import { modules } from "./modules"
import { kindRuns, kinds, watches } from "./registry"

test("each module has its own id, and its Panes' kinds start with it (ADR 0022, decision 5)", () => {
  const ids = modules.map((m) => m.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const m of modules)
    for (const pane of m.panes)
      expect(pane.kind.startsWith(`${m.id}.`)).toBe(true)
  const named = kinds.map((kind) => kind.kind)
  expect(new Set(named).size).toBe(named.length)
})

test("a Pane shows while the engine runs its module, or always for a module with no engine part", () => {
  expect(kindRuns("agents.thread", [])).toBe(false)
  expect(kindRuns("agents.thread", ["agents"])).toBe(true)
  expect(kindRuns("terminal.terminal", ["agents"])).toBe(false)
  expect(kindRuns("browser.browser", [])).toBe(true)
  expect(kindRuns("window.launcher", [])).toBe(true)
  expect(kindRuns("nobody.knows", ["nobody"])).toBe(false)
  expect(watches.map(({ module }) => module.id)).toEqual(["agents"])
})

/** Ids an action kept as it moved to its module, so `keys.toml` stays
 * right (ADR 0022, decision 3). */
const KEPT = ["thread.new"]

test("a module's new action's id starts with its module's id", () => {
  for (const m of modules)
    for (const action of m.actions)
      if (!KEPT.includes(action.id))
        expect(action.id.startsWith(`${m.id}.`)).toBe(true)
  expect(modules.flatMap((m) => m.actions.map((a) => a.id))).toEqual(
    expect.arrayContaining(KEPT)
  )
})
