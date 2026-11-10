import type { ProjectSummary } from "@banda/contract"
import { AGENTS_FILE, DEFAULT_AGENTS, type Flow } from "@banda/contract/agents"
import type { Look } from "@banda/contract/look"
import { takeLook } from "@banda/ui/lib/look"
import type { Args } from "@banda/ui/module"
import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import type { Change, Plan } from "../tiling/arrange"
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
  bringing,
  closingShown,
  movesAway,
  noProjectOf,
  opening,
  openFrom,
  picking,
  placeFor,
  placingOf,
  strayedIn,
  type Placing,
  pickOf,
  runAction,
  type Shell,
  targetsOf,
  startingHere,
  updating,
  windowApiOf,
  arranging,
} from "./actions"

const thread = (id: string): PaneState => ({
  kind: "agents.thread",
  args: { thread: id },
})

// What the toasts were told, as Sonner still shows them.
const toasted = vi.hoisted(() => vi.fn())
vi.mock("@banda/ui/components/sonner", async (actual) => {
  const { toast } = await actual<typeof import("@banda/ui/components/sonner")>()
  const told = (...args: Parameters<typeof toast>) => {
    toasted(...args)
    return toast(...args)
  }
  return { toast: Object.assign(told, toast) }
})

/** Projects by their ids and names, as the window lists them. */
const projectsOf = (names: Record<string, string>, scratch: string[] = []) =>
  Object.entries(names).map(([id, name]) => ({
    id,
    name,
    scratch: scratch.includes(id),
  })) as unknown as ProjectSummary[]

/** A lookup of `projects` by ID, as the window's. */
const lookupOf = (projects: readonly ProjectSummary[]) => (id: string) =>
  projects.find((one) => one.id === id)

/** The Flow agents.toml says now. */
const inFlow = (flow: Flow) =>
  takeLook({
    files: { [AGENTS_FILE.name]: { ...DEFAULT_AGENTS, flow } },
  } as unknown as Look)

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
  // What an Agent opens with its Thread not shown: the same.
  expect(placeFor(free, "a", terminal, row, true)).toBe("project")
  expect(
    placeFor(free, "a", terminal, { ...row, scratch: () => true }, true)
  ).toBe("free")
  // Of no Project, from its Thread's Group on a free workspace, into it,
  // as a Project's does; from another's, right of the Pane in front.
  const its = on({ columns: [column("c", "a", "g")] })
  expect(where(its, "solo", true)).toBe("group")
  expect(where(its, "row", true)).toBe("group")
  expect(where(on({ columns: [column("c", "b", "g")] }), "row", true)).toBe(
    "right"
  )
})

test("a draft in the machine's own ID is of no Project: its Thread opens on the top free workspace, and its other Panes stay where they are opened (ADR 0102, decision 1)", () => {
  const projects = [
    { id: "a", scratch: false },
    { id: "s", scratch: true },
  ] as unknown as ProjectSummary[]
  // Those of no Project, whose emptied workspace goes too, as a Project's
  // with no Threads does; before the engine names the machine, only the
  // scratch Projects.
  const none = noProjectOf(projects, "machine")
  expect(none).toEqual(["machine", "s"])
  expect(noProjectOf(projects)).toEqual(["s"])
  const placing = placingOf("row", none)
  expect(["a", "s", "machine", "b"].map(placing.scratch)).toEqual([
    false,
    true,
    true,
    false,
  ])
  const draft = { kind: "agents.thread", args: { thread: "t" } }
  expect(placeFor(start(), "machine", draft, placing)).toBe("free")
  const terminal = { kind: "terminal.terminal", args: {} }
  const free = open(start(), "b", terminal, { place: "right" })
  expect(placeFor(free, "machine", terminal, placing)).toBe("right")
})

/** Work's workspace, holding its draft `e`, and a free one holding a
 * terminal, `f`. */
function draftOnWork(): Workspaces {
  const draft = { kind: "agents.thread", args: { harness: "fake" } }
  const terminal = { kind: "terminal.terminal", args: {} }
  const column = (id: string, entry: Column["entries"][number]): Column => ({
    id,
    active: 0,
    entries: [entry],
  })
  return {
    list: [
      {
        id: "work",
        project: "work",
        focus: 0,
        columns: [column("c", { id: "e", project: "work", pane: draft })],
      },
      {
        id: "free",
        focus: 0,
        columns: [column("d", { id: "f", project: "work", pane: terminal })],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  }
}

test("a Pane in place of one on a Project's workspace goes elsewhere when it shows the same in another Project, or in none, in the row and solo (ADR 0102, decision 1)", () => {
  const state = draftOnWork()
  const row = placingOf("row", ["machine"])
  const draft: PaneState = { kind: "agents.thread", args: { harness: "fake" } }
  const away = (from: string, project: string, pane = draft, placing = row) =>
    movesAway(state, from, project, pane, placing)
  // A draft moved to Brand, or to No Project, from Work's workspace.
  expect(away("e", "brand")).toBe(true)
  expect(away("e", "machine")).toBe(true)
  expect(away("e", "brand", draft, placingOf("solo", []))).toBe(true)
  // The same Project; a free workspace, which takes any; the Flow free.
  expect(away("e", "work")).toBe(false)
  expect(away("f", "brand")).toBe(false)
  expect(away("e", "brand", draft, placingOf("free", []))).toBe(false)
  // From one in no workspace, as the drawer's.
  expect(away("", "brand")).toBe(false)
  // A draft that became its Thread, in a scratch Project not listed yet,
  // or another machine's: it stays where it stood.
  expect(away("e", "scratch", thread("t1"))).toBe(false)
})

test("a draft moved to another Project opens anew where the Flow says, and its tile closes once that is drawn; on a free workspace, or once it became its Thread, it is replaced in place (ADR 0102, decision 1)", async () => {
  const state = draftOnWork()
  const row = placingOf("row", ["machine"])
  const draft: PaneState = { kind: "agents.thread", args: { harness: "fake" } }
  const asked = async (
    from: string,
    project: string,
    pane = draft,
    opens = true
  ) => {
    const plans: unknown[] = []
    const changing = (how: Change) => {
      plans.push(how(state))
      return Promise.resolve(opens ? "new" : undefined)
    }
    await openFrom(changing, state, row, project, pane, from, "instead")
    return plans as { command: { method: string; params: object } }[]
  }
  const [brand, closed] = await asked("e", "brand")
  expect(brand!.command).toMatchObject({
    method: "workspaces.open",
    params: { project: "brand", place: { to: "project", project: "brand" } },
  })
  expect(closed).toEqual({
    command: { method: "workspaces.close", params: { pane: "e" } },
  })
  // No Project: the top free workspace.
  const [none] = await asked("e", "machine")
  expect(none!.command.params).toMatchObject({ place: { to: "free" } })
  // Opened nowhere, it closes nothing.
  expect(await asked("e", "brand", draft, false)).toHaveLength(1)
  // On a free workspace, in place.
  const [kept, ...rest] = await asked("f", "brand")
  expect(kept!.command).toMatchObject({
    method: "workspaces.open",
    params: { project: "brand", instead: "f" },
  })
  expect(rest).toEqual([])
  // Its first message, its Thread in a new scratch Project: in place, on
  // Work's workspace still.
  const [sent, ...after] = await asked("e", "scratch", thread("t1"))
  expect(sent!.command).toMatchObject({
    method: "workspaces.open",
    params: { project: "scratch", instead: "e" },
  })
  expect(after).toEqual([])
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
      { id: "mine", project: "a", columns: [], focus: 0 },
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
    current: 1,
  }
  const row = { flow: "row", scratch: () => false } as const
  expect([...strayedIn(state, row)]).toEqual(["t1"])
  expect([...strayedIn(state, { ...row, flow: "solo" })]).toEqual(["t1"])
  expect(strayedIn(state, { ...row, flow: "free" }).size).toBe(0)
  expect(strayedIn(state, { ...row, scratch: () => true }).size).toBe(0)
})

test("from the Flow free to the row, no Project has a workspace yet, and no Thread is away from one (ADR 0102, decisions 6 and 9)", () => {
  const entry = (id: string, project: string) => ({
    id,
    project,
    pane: thread(id),
  })
  // Free formed these: none is a Project's.
  const state: Workspaces = {
    list: [
      {
        id: "one",
        focus: 0,
        columns: [
          { id: "c1", active: 0, entries: [entry("t1", "a")] },
          { id: "c2", active: 0, entries: [entry("t2", "b")] },
        ],
      },
      {
        id: "two",
        focus: 0,
        columns: [{ id: "c3", active: 0, entries: [entry("t3", "a")] }],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  }
  const row = { flow: "row", scratch: () => false } as const
  expect(strayedIn(state, row).size).toBe(0)
  // Once a's first new Thread makes it one, a's Threads elsewhere are
  // away; b's, with none, are not.
  const made: Workspaces = {
    ...state,
    list: [
      ...state.list.slice(0, 2),
      {
        id: "a's",
        project: "a",
        focus: 0,
        columns: [{ id: "c4", active: 0, entries: [entry("t4", "a")] }],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
  }
  expect([...strayedIn(made, row)].sort()).toEqual(["t1", "t3"])
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
    inFlow(flow)
    let step: unknown
    const shell = {
      change: (how: (w: Workspaces) => unknown) => (step = how(state)),
      projectOf: lookupOf(projectsOf({ a: "Banda", b: "Brand" })),
    } as unknown as Shell
    runAction(shell, "pane.send-2")
    return step
  }
  toasted.mockClear()
  expect(sent("row")).toBeUndefined()
  // It says whose the workspace is, and where Banda's Panes go.
  expect(toasted).toHaveBeenCalledWith("Workspace 2 is Brand's", {
    id: expect.any(String),
    description: "Banda's Panes go to its workspace, a free one or a new one.",
  })
  expect(sent("free")).toBeDefined()
  // The Pane menu greys out the same workspace, and shows whose each is.
  inFlow("row")
  const projects = projectsOf({ a: "Banda", b: "Brand" })
  const projectOf = lookupOf(projects)
  const at = { workspace: 0, column: 0, entry: 0 }
  expect(targetsOf(state, at, projectOf)).toEqual([
    { owner: projects[0], refused: false },
    { owner: projects[1], refused: true },
    { owner: undefined, refused: false },
  ])
  inFlow("free")
  expect(targetsOf(state, at, projectOf).map((one) => one.refused)).toEqual([
    false,
    false,
    false,
  ])
})

test("a refused move names the workspace by its number before the move, though the free one it leaves goes (ADR 0102, decision 6)", () => {
  inFlow("row")
  const terminal = { kind: "terminal.terminal", args: {} }
  const one = (id: string, project: string, pane: PaneState = terminal) => ({
    id: `${id}-c`,
    active: 0,
    entries: [{ id, project, pane }],
  })
  // Banda's, then a free one with only a Thread of no Project, on screen,
  // then Brand's.
  const state: Workspaces = {
    list: [
      { id: "mine", project: "a", focus: 0, columns: [one("e", "a")] },
      { id: "free", focus: 0, columns: [one("t", "s", thread("t1"))] },
      { id: "theirs", project: "b", focus: 0, columns: [one("f", "b")] },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 1,
  }
  const projects = projectsOf({ a: "Banda", b: "Brand", s: "" }, ["s"])
  const shell = {
    change: (how: (w: Workspaces) => unknown) =>
      expect(how(state)).toBeUndefined(),
    projectOf: lookupOf(projects),
  } as unknown as Shell
  for (const action of ["pane.send-3", "pane.move-down-or-to-workspace"]) {
    toasted.mockClear()
    runAction(shell, action)
    expect(toasted).toHaveBeenCalledWith("Workspace 3 is Brand's", {
      id: expect.any(String),
      description:
        "A Pane of no Project goes to a free workspace or a new one.",
    })
  }
})

test("Alt+Shift+N on a Pane of the Project's own Group moves it alone; on an Agent's Group, the whole Group (ADR 0102, decision 4)", () => {
  inFlow("row")
  const terminal = { kind: "terminal.terminal", args: {} }
  const column = (id: string, group: string, pane = terminal): Column => ({
    id,
    active: 0,
    group,
    entries: [{ id: `${id}-e`, project: "a", pane }],
  })
  const on = (focus: number): Workspaces => ({
    list: [
      {
        id: "mine",
        project: "a",
        own: "own",
        focus,
        columns: [
          column("x1", "own"),
          column("x2", "own"),
          column("t1", "agent", thread("t1")),
        ],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  })
  const sent = (state: Workspaces) => {
    let step: unknown
    const shell = {
      change: (how: (w: Workspaces) => unknown) => (step = how(state)),
      projectOf: () => undefined,
    } as unknown as Shell
    runAction(shell, "pane.send-2")
    return step
  }
  expect(sent(on(1))).toMatchObject({
    command: { method: "workspaces.move_pane", params: { pane: "x2-e" } },
  })
  expect(sent(on(2))).toMatchObject({
    command: { method: "workspaces.move_group", params: { column: "t1" } },
  })
})

test("Open beside brings a Thread onto a free workspace or its Project's, never onto another Project's in the row (ADR 0102, decision 6)", () => {
  const pane = thread("t1")
  const terminal = { kind: "terminal.terminal", args: {} }
  const on = (project?: string): Workspaces => ({
    list: [
      {
        id: "here",
        focus: 0,
        ...(project !== undefined && { project }),
        columns: [
          {
            id: "c",
            active: 0,
            entries: [{ id: "e", project: project ?? "b", pane: terminal }],
          },
        ],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  })
  const projects = projectsOf({ a: "Banda", b: "Brand", s: "" }, ["s"])
  const projectOf = lookupOf(projects)
  const row = placingOf("row", noProjectOf(projects))
  toasted.mockClear()
  expect(bringing(on("b"), "a", pane, row, projectOf)).toBeUndefined()
  expect(toasted).toHaveBeenCalledWith("Workspace 1 is Brand's", {
    id: expect.any(String),
    description: "Banda's Panes go to its workspace, a free one or a new one.",
  })
  expect(bringing(on(), "a", pane, row, projectOf)).toBeDefined()
  expect(bringing(on("a"), "a", pane, row, projectOf)).toBeDefined()
  // A Thread of no Project hears where it goes: a free workspace.
  expect(bringing(on("b"), "s", pane, row, projectOf)).toBeUndefined()
  expect(toasted).toHaveBeenLastCalledWith("Workspace 1 is Brand's", {
    id: expect.any(String),
    description: "A Pane of no Project goes to a free workspace or a new one.",
  })
  // In the Flow free, every workspace is free.
  const free = placingOf("free", noProjectOf(projects))
  expect(bringing(on("b"), "a", pane, free, projectOf)).toBeDefined()
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

test("a first Pane started on an emptied Project's workspace goes where the keys put it, into its own Group, and on one of no Project there (ADR 0102, decision 4)", () => {
  const terminal = { kind: "terminal.terminal", args: {} }
  const row: Placing = { flow: "row", scratch: () => false }
  const emptied: Workspaces = {
    list: [
      { id: "mine", project: "a", focus: 0, columns: [] },
      { id: "bottom", focus: 0, columns: [] },
    ],
    current: 0,
  }
  expect(placeFor(emptied, "a", terminal, row)).toBe("own")
  expect(startingHere(emptied, "home", terminal, row)).toMatchObject({
    command: {
      method: "workspaces.open",
      params: { project: "a", place: { to: "own", project: "a" } },
    },
  })
  // On the empty one at the bottom, a column there, in the home Project.
  const plus = { ...emptied, current: 1 }
  expect(startingHere(plus, "home", terminal, row)).toMatchObject({
    command: {
      params: {
        project: "home",
        place: { to: "column", workspace: "bottom", index: 0 },
      },
    },
  })
  // In the Flow free, there too, in its Project.
  const free = { ...row, flow: "free" } as const
  expect(startingHere(emptied, "home", terminal, free)).toMatchObject({
    command: {
      params: {
        project: "a",
        place: { to: "column", workspace: "mine", index: 0 },
      },
    },
  })
})

test("workspace.close leaves an emptied workspace for the one above, or below from the first, then lets it go; by its ID from elsewhere, the window stays (ADR 0102, decision 2)", () => {
  const terminal = { kind: "terminal.terminal", args: {} }
  const busy = {
    id: "theirs",
    project: "b",
    focus: 0,
    columns: [
      {
        id: "c",
        active: 0,
        entries: [{ id: "e", project: "b", pane: terminal }],
      },
    ],
  }
  const mine = { id: "mine", project: "a", focus: 0, columns: [] }
  const bottom = { id: "bottom", focus: 0, columns: [] }
  const closing = (list: Workspace[], current: number) => {
    let state: Workspaces = { list, current }
    const sent: unknown[] = []
    const shell = {
      change: (how: (w: Workspaces) => Workspaces | Plan | undefined) => {
        const step = how(state)
        if (step && "command" in step) sent.push(step.command)
        else if (step) state = step
      },
      here: {
        get: () => ({ workspace: { id: state.list[state.current]!.id } }),
      },
    } as unknown as Shell
    const close = (args?: Args) => {
      runAction(shell, "workspace.close", args)
      return { at: state.current, sent: [...sent] }
    }
    return close
  }
  const tidy = (keep: string, projects: string[]) => ({
    method: "workspaces.tidy",
    params: { keep, projects },
  })

  // From the one on screen: up, then it goes.
  expect(closing([busy, mine, bottom], 1)()).toEqual({
    at: 0,
    sent: [tidy("theirs", ["b"])],
  })
  // From the first: down.
  expect(closing([mine, busy, bottom], 0)()).toEqual({
    at: 1,
    sent: [tidy("theirs", ["b"])],
  })
  // By its ID, from the overview while another is on screen: it stays.
  expect(closing([busy, mine, bottom], 0)({ workspace: "mine" })).toEqual({
    at: 0,
    sent: [tidy("theirs", ["b"])],
  })
  // One that holds a Pane, the empty one at the bottom: nothing.
  expect(closing([busy, mine, bottom], 0)()).toEqual({ at: 0, sent: [] })
  expect(closing([busy, mine, bottom], 2)()).toEqual({ at: 2, sent: [] })

  // In the Banda menu, with no key: a held Alt+W would go on to close
  // the Panes of the workspace it goes to.
  const action = ACTIONS.find((action) => action.id === "workspace.close")
  expect(action?.keys).toBeUndefined()
  expect(action?.unlisted).toBeUndefined()
})
