import { AGENTS_FILE, DEFAULT_AGENTS } from "@banda/contract/agents"
import type { Look } from "@banda/contract/look"
import { takeLook } from "@banda/ui/lib/look"
import type { Args } from "@banda/ui/module"
import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import { entries, focused, open, start, type Workspaces } from "../tiling/model"
import {
  closingShown,
  opening,
  picking,
  pickOf,
  runAction,
  type Shell,
  updating,
  windowApiOf,
} from "./actions"

const thread = (id: string): PaneState => ({
  kind: "agents.thread",
  args: { thread: id },
})

test("an archived Thread's Pane closes, and only its own", () => {
  const right = { place: "right" } as const
  let state = start()
  state = open(state, "project-a", thread("t1"), right)
  state = open(state, "project-a", thread("t2"), right)
  state = open(state, "project-b", thread("t1"), right)
  const [, second] = entries(state)

  expect(closingShown(state, { project: "project-a", about: "t2" })).toEqual({
    command: { method: "workspaces.close", params: { pane: second!.id } },
  })
  // No Pane shows it: nothing to close.
  expect(
    closingShown(state, { project: "project-a", about: "t3" })
  ).toBeUndefined()
  expect(
    closingShown(state, { project: "project-c", about: "t1" })
  ).toBeUndefined()
})

test("a Thread opens as a Group, and a Pane of another kind in none", () => {
  const params = (pane: PaneState) => {
    const plan = opening(start(), "project-a", pane, { place: "right" })
    return plan && "command" in plan ? plan.command.params : undefined
  }
  expect(params(thread("t1"))).toMatchObject({ grouped: true })
  const diff = { kind: "git.diff", args: { scope: { kind: "changes" } } }
  expect(params(diff)).not.toHaveProperty("grouped")
})

test("opened to update, a Pane shown as its kind names it takes the new args, and the focus", () => {
  const diff = (scope: string): PaneState => ({
    kind: "git.diff",
    args: { scope: { kind: scope }, file: null },
  })
  const state = open(start(), "project-a", diff("changes"), { place: "right" })
  const [shown] = entries(state)

  // The Project's one Diff, as its kind names it, with another scope.
  expect(updating(state, "project-a", diff("staged"))).toEqual({
    command: {
      method: "workspaces.update",
      params: { pane: shown!.id, args: diff("staged").args },
    },
    want: shown!.id,
  })
  // The same args: only the focus.
  const same = updating(state, "project-a", diff("changes"))
  expect(entries(same as typeof state)).toEqual(entries(state))
  // None shown in that Project: it opens.
  expect(updating(state, "project-b", diff("staged"))).toMatchObject({
    command: { method: "workspaces.open" },
  })
})

test("a module is given the Window's API alone, as it is when asked", () => {
  let home = "a"
  const shell = new Proxy({} as Shell, {
    get: (_, key) => (key === "home" ? home : () => String(key)),
  })
  const api = windowApiOf(shell)
  for (const own of ["change", "quit", "route", "ownKeys", "toggleSidebar"])
    expect(Object.keys(api)).not.toContain(own)
  expect(api.run("thread.new")).toBe("run")
  home = "b"
  expect(api.home).toBe("b")
})

test("a pick goes to the Pane that shows its thing, on any workspace, else opens it where its kind's home is", () => {
  const right = { place: "right" } as const
  let state = start()
  state = open(state, "project-a", thread("t1"), right)
  // Its args since grew, as a Thread whose details card the Person hid.
  const hid = { kind: "agents.thread", args: { thread: "t2", details: false } }
  state = open(state, "project-a", hid, right)
  state = open(state, "project-b", thread("t3"), right)
  const [first, second] = entries(state)
  const focus = (project: string, pane: PaneState) =>
    focused(picking(state, project, pane) as Workspaces)?.id

  expect(focus("project-a", thread("t1"))).toBe(first!.id)
  // The thing it shows, whatever else its args say: no second Pane.
  expect(focus("project-a", thread("t2"))).toBe(second!.id)
  // Shown in another Project only: it opens, where its kind's home is,
  // with the args it was picked with.
  const t3 = thread("t3")
  expect(picking(state, "project-a", t3)).toMatchObject({
    command: {
      method: "workspaces.open",
      params: { project: "project-a", kind: "agents.thread", args: t3.args },
    },
  })
  // Where the Flow says: a new column right of the Pane in front in Free,
  // the first on an empty workspace; last on its Project's workspace in
  // Row, the Flow there is before a look comes.
  for (const [flow, place] of [
    ["free", { to: "column", index: 0 }],
    ["row", { to: "project", project: "project-a" }],
  ] as const) {
    const files = { [AGENTS_FILE.name]: { ...DEFAULT_AGENTS, flow } }
    takeLook({ files } as unknown as Look)
    expect(picking(start(), "project-a", t3)).toMatchObject({
      command: { params: { place } },
    })
  }
  // A kind that names no thing: the Pane that is the same one, as its
  // kind names it.
  const usage = { kind: "harnesses.usage", args: {} }
  const used = open(
    open(state, "project-a", usage, right),
    "project-a",
    t3,
    right
  )
  const shown = entries(used).find((entry) => entry.pane.kind === usage.kind)
  expect(focused(picking(used, "project-a", usage) as Workspaces)?.id).toBe(
    shown!.id
  )
})

test("pane.pick takes a Project and a Pane, as an Item carries it, and only it reaches the Window's answer", () => {
  const pane = thread("t1")
  expect(pickOf({ project: "project-a", pane })).toEqual({
    project: "project-a",
    pane,
  })
  const wrong: (Args | undefined)[] = [
    undefined,
    {},
    { project: "project-a" },
    { project: 1, pane },
    { project: "project-a", pane: "t1" },
    { project: "project-a", pane: { kind: "agents.thread" } },
    { project: "project-a", pane: { kind: 1, args: {} } },
    { project: "project-a", pane: { kind: "agents.thread", args: [] } },
  ]
  for (const args of wrong) expect(pickOf(args)).toBeUndefined()

  const pick = vi.fn()
  const shell = { pick } as unknown as Shell
  runAction(shell, "pane.pick", { project: "project-a", pane })
  runAction(shell, "pane.pick", { project: "project-a" })
  expect(pick.mock.calls).toEqual([["project-a", pane]])
})

test("a Project's verbs and the menu at a route do what the sidebar's buttons did, by their ids", () => {
  const route = vi.fn()
  const settings = vi.fn()
  const command = vi.fn(() => Promise.resolve({}))
  const shell = { route, settings, engine: { command } } as unknown as Shell

  // The Search opens the menu at its root, the key sheet's button at its
  // Actions (`openingOf`), as `banda menu` does.
  runAction(shell, "menu.route")
  runAction(shell, "menu.route", { route: "actions" })
  // A missing Project's folder is found in the menu; its settings are its
  // own.
  runAction(shell, "projects.locate", { project: "p1" })
  runAction(shell, "projects.settings", { project: "p1" })
  expect(route.mock.calls).toEqual([[""], ["actions"], ["project.locate.p1"]])
  expect(settings.mock.calls).toEqual([["projects/p1"]])

  // A pin goes to the engine as the Project's update, and only with a
  // Project and whether it is pinned.
  runAction(shell, "projects.pin", { project: "p1", pinned: true })
  runAction(shell, "projects.pin", { project: "p1", pinned: false })
  const halves: (Args | undefined)[] = [
    undefined,
    { project: "p1" },
    { pinned: true },
  ]
  for (const args of halves) runAction(shell, "projects.pin", args)
  runAction(shell, "projects.locate")
  runAction(shell, "projects.settings", { project: 1 })
  expect(command.mock.calls).toEqual([
    ["projects.update", { project: "p1", pinned: true }],
    ["projects.update", { project: "p1", pinned: false }],
  ])
  expect(route).toHaveBeenCalledTimes(3)
  expect(settings).toHaveBeenCalledTimes(1)
})
