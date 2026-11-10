import type { ProjectSummary } from "@banda/contract"
import { AGENTS_FILE, DEFAULT_AGENTS, type Flow } from "@banda/contract/agents"
import type { Look } from "@banda/contract/look"
import { takeLook } from "@banda/ui/lib/look"
import type { Args } from "@banda/ui/module"
import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import {
  type Column,
  entries,
  focused,
  fresh,
  open,
  start,
  type Workspace,
  type Workspaces,
} from "../tiling/model"
import {
  ACTIONS,
  closingShown,
  opening,
  picking,
  placeFor,
  strayedIn,
  type Placing,
  pickOf,
  runAction,
  type Shell,
  updating,
  windowApiOf,
  arranging,
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
  const placing = (flow: Flow, scratch = false): Placing => ({
    flow,
    scratch: () => scratch,
  })
  const row = placing("row")
  const focus = (project: string, pane: PaneState) =>
    focused(picking(state, project, pane, row) as Workspaces)?.id

  expect(focus("project-a", thread("t1"))).toBe(first!.id)
  // The thing it shows, whatever else its args say: no second Pane.
  expect(focus("project-a", thread("t2"))).toBe(second!.id)
  // Shown in another Project only: it opens, where its kind's home is,
  // with the args it was picked with.
  const t3 = thread("t3")
  expect(picking(state, "project-a", t3, row)).toMatchObject({
    command: {
      method: "workspaces.open",
      params: { project: "project-a", kind: "agents.thread", args: t3.args },
    },
  })
  // Where the Flow says: a new column right of the Pane in front in Free,
  // the first on an empty workspace; last on its Project's workspace in
  // Row, the Flow there is before a look comes; of no Project, on the top
  // free workspace (ADR 0102, decision 1).
  for (const [flow, scratch, place] of [
    ["free", false, { to: "column", index: 0 }],
    ["row", false, { to: "project", project: "project-a" }],
    ["row", true, { to: "free" }],
  ] as const) {
    const files = { [AGENTS_FILE.name]: { ...DEFAULT_AGENTS, flow } }
    takeLook({ files } as unknown as Look)
    expect(
      picking(start(), "project-a", t3, placing(flow, scratch))
    ).toMatchObject({ command: { params: { place } } })
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
  expect(
    focused(picking(used, "project-a", usage, row) as Workspaces)?.id
  ).toBe(shown!.id)
})

test("a Pane the Person opens goes where the Flow says (ADR 0102, decision 3)", () => {
  const entry = (id: string, project: string, kind = "terminal.terminal") => ({
    id,
    project,
    pane: { kind, args: {} },
  })
  const column = (id: string, project: string, group?: string): Column => ({
    id,
    entries: [entry(`${id}-e`, project)],
    active: 0,
    ...(group !== undefined && { group }),
  })
  const on = (workspace: Partial<Workspace>): Workspaces => ({
    list: [
      { id: "w", columns: [], focus: 0, ...workspace },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  })
  const terminal = { kind: "terminal.terminal", args: {} }
  const where = (state: Workspaces, flow: Flow = "row", scratch = false) =>
    placeFor(state, "a", terminal, { flow, scratch: () => scratch })
  const mine = on({ project: "a", columns: [column("c", "a")] })
  const grouped = on({ project: "a", columns: [column("c", "a", "g")] })
  const theirs = on({ project: "b", columns: [column("c", "b")] })
  const free = on({ columns: [column("c", "b")] })
  // Free: right of the Pane in front, wherever it is.
  expect(where(theirs, "free")).toBe("right")
  // In a Group of its Project, into it; anywhere else on a Project's
  // workspace, its own or another's, into its Project's own Group.
  expect(where(grouped)).toBe("group")
  expect(where(mine)).toBe("own")
  expect(where(theirs)).toBe("own")
  expect(where(on({ project: "b", columns: [column("c", "b", "g")] }))).toBe(
    "own"
  )
  // An empty workspace: its own Group too.
  expect(where(on({}))).toBe("own")
  // From inside its own Group, last into it.
  expect(
    where(on({ project: "a", own: "g", columns: [column("c", "a", "g")] }))
  ).toBe("own")
  // A free workspace keeps it, right of the Pane in front, as one of no
  // Project does anywhere.
  expect(where(free)).toBe("right")
  expect(where(theirs, "solo", true)).toBe("right")
  // A Thread: its Project's workspace, or of no Project the top free one.
  const thread = { kind: "agents.thread", args: { thread: "t" } }
  const row = { flow: "row", scratch: () => false } as const
  expect(placeFor(free, "a", thread, row)).toBe("project")
  expect(placeFor(free, "a", thread, { ...row, scratch: () => true })).toBe(
    "free"
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

  // A pick takes the Sheet away, even to the Pane in focus (ADR 0102,
  // decision 5).
  const pick = vi.fn()
  const closeSheet = vi.fn(() => true)
  const shell = { pick, closeSheet } as unknown as Shell
  runAction(shell, "pane.pick", { project: "project-a", pane })
  runAction(shell, "pane.pick", { project: "project-a" })
  expect(pick.mock.calls).toEqual([["project-a", pane]])
  expect(closeSheet).toHaveBeenCalledOnce()
})

test("a Project's verbs and the menu at a route do what the sidebar's buttons did, by their ids", () => {
  const route = vi.fn()
  const settings = vi.fn()
  const command = vi.fn(() => Promise.resolve({}))
  const shell = { route, settings, engine: { command } } as unknown as Shell

  // The Search opens the menu at its root, the key sheet's button at its
  // Actions (`openingOf`), as `banda menu` does.
  runAction(shell, "menu.at")
  runAction(shell, "menu.at", { route: "actions" })
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

test("flow.pick writes the Flow it names into agents.toml, as flow.solo does from the one in force, and a word it does not know nothing", async () => {
  const writeSetting = vi.fn(() => Promise.resolve([] as string[]))
  const shell = { writeSetting } as unknown as Shell
  takeLook({
    files: { [AGENTS_FILE.name]: { ...DEFAULT_AGENTS, flow: "row" } },
  } as unknown as Look)

  runAction(shell, "flow.pick", { flow: "free" })
  runAction(shell, "flow.pick", { flow: "solo" })
  for (const args of [undefined, { flow: "toString" }, { flow: 1 }])
    runAction(shell, "flow.pick", args)
  runAction(shell, "flow.solo")
  expect(writeSetting.mock.calls).toEqual([
    [AGENTS_FILE.name, "flow", '"free"'],
    [AGENTS_FILE.name, "flow", '"solo"'],
    [AGENTS_FILE.name, "flow", '"solo"'],
  ])

  // A refused write says so in the console, as the menu's did.
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
  writeSetting.mockResolvedValueOnce(["flow: not a Flow"])
  runAction(shell, "flow.pick", { flow: "row" })
  await vi.waitFor(() =>
    expect(error).toHaveBeenCalledWith(`banda: ${AGENTS_FILE.name} refused`, [
      "flow: not a Flow",
    ])
  )
  error.mockRestore()
})

test("workspace.go goes to a workspace by its place, past the ninth too, and only a number on the Bar runs it: unlisted, with no key", () => {
  let state = start()
  for (let n = 1; n <= 11; n++)
    state = open(fresh(state), "project-a", thread(`t${n}`), { place: "right" })
  const change = vi.fn((how: (state: Workspaces) => Workspaces | undefined) => {
    state = how(state) ?? state
    return Promise.resolve()
  })
  const shell = { change } as unknown as Shell

  runAction(shell, "workspace.go", { index: 10 })
  expect(state.current).toBe(10)
  expect(focused(state)?.pane).toEqual(thread("t11"))
  runAction(shell, "workspace.go", { index: 0 })
  expect(focused(state)?.pane).toEqual(thread("t1"))
  // Not a place: nothing moves.
  const wrong: (Args | undefined)[] = [
    undefined,
    {},
    { index: "3" },
    { index: 1.5 },
  ]
  for (const args of wrong) runAction(shell, "workspace.go", args)
  expect(change).toHaveBeenCalledTimes(2)

  const action = ACTIONS.find((action) => action.id === "workspace.go")
  expect(action?.unlisted).toBe(true)
  expect(action?.keys).toBeUndefined()
})

test("a Thread on a free workspace stands away from its Project's, in the row and solo (ADR 0102, decision 6)", () => {
  const thread = { kind: "agents.thread", args: { thread: "t1" } }
  const state: Workspaces = {
    list: [
      {
        id: "free",
        focus: 0,
        columns: [
          {
            id: "c",
            active: 0,
            entries: [{ id: "e", project: "a", pane: thread }],
          },
        ],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  }
  const row = { flow: "row", scratch: () => false } as const
  expect([...strayedIn(state, row)]).toEqual(["t1"])
  expect(strayedIn(state, { ...row, flow: "free" }).size).toBe(0)
  expect(strayedIn(state, { ...row, scratch: () => true }).size).toBe(0)
})

test("Alt+Shift+N onto another Project's workspace does nothing in the row, and moves in the free Flow (ADR 0102, decision 6)", () => {
  const terminal = { kind: "terminal.terminal", args: {} }
  const state: Workspaces = {
    list: [
      {
        id: "mine",
        project: "a",
        focus: 0,
        columns: [
          {
            id: "c",
            active: 0,
            entries: [{ id: "e", project: "a", pane: terminal }],
          },
        ],
      },
      {
        id: "theirs",
        project: "b",
        focus: 0,
        columns: [
          {
            id: "d",
            active: 0,
            entries: [{ id: "f", project: "b", pane: terminal }],
          },
        ],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  }
  const sent = (flow: Flow) => {
    takeLook({
      files: { [AGENTS_FILE.name]: { ...DEFAULT_AGENTS, flow } },
    } as unknown as Look)
    let step: unknown
    const shell = {
      change: (how: (w: Workspaces) => unknown) => (step = how(state)),
    } as unknown as Shell
    runAction(shell, "pane.send-2")
    return step
  }
  expect(sent("row")).toBeUndefined()
  expect(sent("free")).toBeDefined()
})

test("Arrange by Project names the Projects that have a workspace, and with one Project only it (ADR 0102, decisions 7 and 9)", () => {
  const projects = [
    { id: "a", scratch: false },
    { id: "s", scratch: true },
  ] as unknown as ProjectSummary[]
  const state = open(
    start(),
    "a",
    { kind: "terminal.shell", args: {} },
    {
      place: "right",
    }
  )
  const arranged = arranging(state, projects)
  expect(arranged.command).toEqual({
    method: "workspaces.arrange",
    params: { projects: ["a"] },
  })
  // The Pane in front goes along.
  expect(arranged.want).toBe(focused(state)?.id)
  expect(arranging(state, projects, "a").command.params).toEqual({
    projects: ["a"],
    only: "a",
  })
})
