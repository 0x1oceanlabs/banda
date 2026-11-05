import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ProjectId } from "@banda/contract"
import type { Action, Module } from "@banda/ui/module"
import { expect, test } from "vitest"
import { modules } from "./modules"
import { WINDOW_ACTIONS } from "./shell/actions"
import { windowModule } from "./registry"
import { samePane } from "./workspaces/model"
import {
  identityOf,
  kindRuns,
  kinds,
  labelOf,
  saidNow,
  sayLabel,
  showsOf,
  watches,
} from "./registry"

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
  expect(watches.map(({ module }) => module.id)).toEqual(["agents", "browser"])
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

/** An action as the engine reads it (ADR 0071, decision 2): its keys by
 * level, as its code writes them, for the engine to make real with the
 * mod; where they work, and what it takes. */
function actionOf(action: Action<never>) {
  // JSON leaves out what is not there.
  const {
    id,
    title,
    section,
    keys = [],
    family,
    unlisted,
    scope,
    args,
  } = action
  return { id, title, section, keys, family, unlisted, scope, args }
}

/** What a module's window part offers, as `banda modules` prints it: its
 * code says it; this is a copy for the engine, which has no window. */
function windowOf(module: Module) {
  return {
    panes: module.panes.map((pane) => pane.kind),
    actions: module.actions.map(actionOf),
    ...(module.scopes.length > 0 && { scopes: module.scopes }),
    sources: module.sources.map(({ id, label }) => ({ id, label })),
    watches: module.watches.length,
    bar: module.bar.map(({ id, about }) => ({ id, about })),
  }
}

/** Writes `value` to `file` as JSON when it differs; whether it did. */
function written(file: string, value: unknown): boolean {
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false
  writeFileSync(file, text)
  return true
}

test("the window's own actions, the tiling's, are written for the engine as a module's are (ADR 0071, decision 2)", () => {
  const file = join(import.meta.dirname, "../window.json")
  // Written now: review it and run again, as cargo test does the types.
  expect(
    written(file, {
      actions: WINDOW_ACTIONS.map(actionOf),
      scopes: windowModule.scopes,
    })
  ).toBe(false)
})

test("each module's window part is written beside its module.toml, for banda modules (ADR 0022, decision 1)", () => {
  const stale: string[] = []
  for (const module of modules) {
    const folder = join(import.meta.dirname, "../../../modules", module.id)
    expect(existsSync(join(folder, "module.toml")), module.id).toBe(true)
    if (written(join(folder, "window.json"), windowOf(module)))
      stale.push(module.id)
  }
  // Written now: review it and run again, as cargo test does the types.
  expect(stale).toEqual([])
})

test("a Pane whose args its kind cannot read is named plainly, and the window goes on", () => {
  const broken = { kind: "browser.browser", args: null as never }
  expect(labelOf(broken)).toMatchObject({ title: "Pane", detail: null })
  expect(showsOf(broken)).toBeNull()
  expect(labelOf({ kind: "nobody.knows", args: {} }).title).toBe("Unknown Pane")
})

test("what a Pane says it shows now names it over its kind, till it is taken back", () => {
  const pane = {
    kind: "terminal.terminal",
    args: { terminal: "t1", title: "Terminal", shell: true, done: null },
  }
  sayLabel("e1", { title: "pnpm dev", detail: "~/code/banda" })
  expect(labelOf(pane, saidNow().get("e1"))).toMatchObject({
    title: "pnpm dev",
    detail: "~/code/banda",
  })
  expect(labelOf(pane, saidNow().get("e2")).title).toBe("Terminal")
  sayLabel("e1", null)
  expect(saidNow().has("e1")).toBe(false)
})

test("a terminal that typed its line is the same Pane, so its shell goes on (ADR 0063, decision 6)", () => {
  const terminal = (args: { terminal: string; typed: string | null }) => ({
    project: "s1" as ProjectId,
    pane: {
      kind: "terminal.terminal",
      args: { title: "Terminal", shell: true, done: null, ...args },
    },
  })
  const typing = terminal({ terminal: "t1", typed: "ls" })
  const typed = terminal({ terminal: "t1", typed: null })
  expect(samePane(typing, typed, identityOf)).toBe(true)
  expect(
    samePane(typed, terminal({ terminal: "t2", typed: null }), identityOf)
  ).toBe(false)
})
