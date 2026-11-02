import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Module } from "@banda/ui/module"
import { expect, test } from "vitest"
import { keyName } from "./actions/actions"
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

/** What a module's window part offers, as `banda modules` prints it: its
 * code says it; this is a copy for the engine, which has no window. */
function windowOf(module: Module) {
  return {
    panes: module.panes.map((pane) => pane.kind),
    actions: module.actions.map((action) => ({
      id: action.id,
      title: action.title,
      section: action.section,
      keys: (action.keys ?? []).map(keyName),
      ...(action.family && { family: action.family }),
      ...(action.unlisted && { unlisted: true }),
    })),
    sources: module.sources.map(({ id, label }) => ({ id, label })),
    watches: module.watches.length,
  }
}

test("each module's window part is written beside its module.toml, for banda modules (ADR 0022, decision 1)", () => {
  const stale: string[] = []
  for (const module of modules) {
    const folder = join(import.meta.dirname, "../../../modules", module.id)
    expect(existsSync(join(folder, "module.toml")), module.id).toBe(true)
    const file = join(folder, "window.json")
    const text = `${JSON.stringify(windowOf(module), null, 2)}\n`
    if (existsSync(file) && readFileSync(file, "utf8") === text) continue
    writeFileSync(file, text)
    stale.push(module.id)
  }
  // Written now: review it and run again, as cargo test does the types.
  expect(stale).toEqual([])
})
