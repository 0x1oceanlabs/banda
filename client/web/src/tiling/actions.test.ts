/**
 * The Tiling's actions and what opens a Pane, through the interface the
 * Window hands in (`Tiling`), with a fake of it: no router and no hosts,
 * which the Window's own tests cover (`window/actions.test.ts`).
 */
import {
  type Code,
  newId,
  type ProjectId,
  type ProjectSummary,
  Refused,
} from "@banda/contract"
import type { Look } from "@banda/contract/look"
import {
  DEFAULT_TILING,
  type Flow,
  TILING_FILE,
} from "@banda/contract/workspaces"
import { takeLook } from "@banda/ui/lib/look"
import type { Args } from "@banda/ui/module"
import type { PaneState } from "@banda/ui/pane"
import { expect, test, vi } from "vitest"
import { arranging, targetsOf, TILING_ACTIONS, type Tiling } from "./actions"
import { type Change, NO_VIEW, type Plan, type Step, viewOf } from "./arrange"
import {
  type Column,
  entries,
  focused,
  fresh,
  open,
  start,
  type Workspace,
  type Workspaces,
} from "./model"
import {
  bringing,
  closing,
  closingShown,
  noProjectOf,
  opening,
  openingFrom,
  picking,
  pickOf,
  placed,
  type Placing,
  placingOf,
  startingHere,
  strayedIn,
} from "./opening"
import { hear, look, predict, unseen } from "./unheard"
import { factsOf } from "./useTiling"

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

/** A Tiling of `parts`, as the Window hands one in: what an action
 * under test takes, and no more. */
const tilingOf = (parts: Partial<Tiling>) => parts as Tiling

/** Runs the Tiling's action `id` in `tiling`, as its key would. */
const run = (tiling: Tiling, id: string, args?: Args) =>
  TILING_ACTIONS.find((one) => one.id === id)!.run(tiling, args)

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

/** The Flow tiling.toml says now. */
const inFlow = (flow: Flow) =>
  takeLook({
    files: { [TILING_FILE.name]: { ...DEFAULT_TILING, flow } },
  } as unknown as Look)

/** Projects as the engine names them, which the copy of its rule reads. */
const A = "a0000000-0000-4000-8000-00000000000a" as ProjectId
const B = "a0000000-0000-4000-8000-00000000000b" as ProjectId
const NONE = "a0000000-0000-4000-8000-00000000000c" as ProjectId

const terminal = (n: number): PaneState => ({
  kind: "terminal.terminal",
  args: { n },
})

/** What a plan asks of the engine. */
const paramsOf = (step: Step) =>
  step && "command" in step ? step.command.params : undefined

/** The engine refuses `step`, a plan it was sent, with `code`: `conflict`,
 * as the row refuses a move (ADR 0110, decision 8). What the window says
 * of it is its own to word. */
function refuse(step: unknown, code: Code = "conflict") {
  const plan = step as Plan
  expect(plan.command).toBeDefined()
  expect(plan.refused).toBeDefined()
  plan.refused?.(new Refused({ code, message: "As the engine says it." }))
}

/**
 * A window in `flow`, with `none` of no Project: each change is drawn as
 * the Tiling draws it before the engine answers, its command run by the
 * client's copy of the engine's rule (ADR 0110, decision 9).
 */
function windowIn(flow: Flow, none: ProjectId[] = []) {
  let seen = hear(unseen(NO_VIEW), [{ id: newId(), columns: [] }], 0)
  const placing = placingOf(flow, none)
  return {
    get state() {
      return seen.state
    },
    /** Each workspace's columns, each column's Panes by their args' `n`. */
    layout: () =>
      seen.state.list.map((workspace) =>
        workspace.columns.map((column) =>
          column.entries.map((entry) => entry.pane.args.n)
        )
      ),
    /** Runs a change, and gives the Pane it focuses. */
    change(how: (w: Workspaces, placing: Placing) => Step) {
      const step = how(seen.state, placing)
      if (!step) return undefined
      if (!("command" in step)) {
        seen = look(seen, viewOf(step))
        return focused(step)?.id
      }
      const made = predict(seen, newId(), step, factsOf(flow))
      seen = made.seen
      return made.want
    },
  }
}

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
    return paramsOf(opening(start(), "project-a", pane, { place: "right" }))
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
  const row = placingOf("row", [])
  const updating = (project: string, pane: PaneState) =>
    placed(state, project, pane, row, { update: true })
  expect(updating("project-a", diff("staged"))).toEqual({
    command: {
      method: "workspaces.update",
      params: { pane: shown!.id, args: diff("staged").args },
    },
    want: shown!.id,
  })
  // The same args: only the focus.
  const same = updating("project-a", diff("changes"))
  expect(entries(same as typeof state)).toEqual(entries(state))
  // Not asked to update, it keeps what it shows, and gets the focus.
  const kept = placed(state, "project-a", diff("staged"), row)
  expect(entries(kept as typeof state)).toEqual(entries(state))
  // None shown in that Project: it opens.
  expect(updating("project-b", diff("staged"))).toMatchObject({
    command: { method: "workspaces.open" },
  })
})

test("a pick goes to the Pane that shows its thing, on any workspace, else asks the engine to open it", () => {
  const right = { place: "right" } as const
  let state = start()
  state = open(state, "project-a", thread("t1"), right)
  // Its args since grew, as a Thread whose details card the Person hid.
  const hid = { kind: "agents.thread", args: { thread: "t2", details: false } }
  state = open(state, "project-a", hid, right)
  state = open(state, "project-b", thread("t3"), right)
  const [first, second] = entries(state)
  const row = placingOf("row", [])
  const focus = (project: string, pane: PaneState) =>
    focused(picking(state, project, pane, row) as Workspaces)?.id

  expect(focus("project-a", thread("t1"))).toBe(first!.id)
  // The thing it shows, whatever else its args say: no second Pane.
  expect(focus("project-a", thread("t2"))).toBe(second!.id)
  // Shown in another Project only: it opens, with the args it was picked
  // with, from the Pane in front, and the engine says where.
  const t3 = thread("t3")
  const asked = paramsOf(picking(state, "project-a", t3, row))
  expect(asked).toMatchObject({
    project: "project-a",
    kind: "agents.thread",
    args: t3.args,
    from: focused(state)!.id,
    on: state.list[0].id,
  })
  expect(asked).not.toHaveProperty("place")
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

test("a Pane the Person opens names no place: the window says the Pane in front and the workspace on screen, and the engine places it (ADR 0110, decision 3)", () => {
  for (const flow of ["free", "row", "solo"] as const) {
    const placing = placingOf(flow, [NONE])
    let state = start()
    const here = state.list[0].id
    // On an empty workspace: the workspace alone.
    const first = paramsOf(placed(state, A, terminal(1), placing))
    expect(first).toEqual({
      project: A,
      kind: "terminal.terminal",
      args: { n: 1 },
      again: true,
      on: here,
    })
    // From the Pane in front, a Thread as a Group of its own.
    state = open(state, A, terminal(1), { place: "right" })
    const from = focused(state)!.id
    const second = paramsOf(placed(state, A, thread("t"), placing))
    expect(second).toMatchObject({ from, on: here, grouped: true })
    expect(second).not.toHaveProperty("place")
    // For an Agent, and of no Project, it says so, and still no place.
    const agents = placed(state, NONE, terminal(2), placing, { agents: true })
    expect(paramsOf(agents)).toMatchObject({
      agents: true,
      scratch: true,
      from,
    })
    expect(paramsOf(agents)).not.toHaveProperty("place")
    // A place its caller named goes as named.
    const below = placed(state, A, terminal(3), placing, { place: "below" })
    expect(paramsOf(below)).toMatchObject({ place: { to: "stack", index: 1 } })
    expect(paramsOf(below)).not.toHaveProperty("from")
  }
})

test("a Pane the window opens is drawn at once where the engine's rule puts it, in the Flows free, row and solo (ADR 0110, decision 9)", () => {
  const opened = (flow: Flow) => {
    const window = windowIn(flow, [NONE])
    const open = (project: ProjectId, pane: PaneState, how = {}) =>
      window.change((w, placing) =>
        placed(w, project, pane, placing, { again: true, ...how })
      )
    open(A, terminal(1))
    open(A, terminal(2))
    const three = open(A, { kind: "agents.thread", args: { n: 3 } })
    // It has the focus, by the ID the engine gives it.
    expect(focused(window.state)?.id).toBe(three)
    open(A, terminal(4))
    open(B, terminal(5))
    open(NONE, terminal(6))
    open(A, terminal(7), { agents: true })
    return window
  }
  // Free: each right of the Pane in front, on a workspace no one owns.
  const free = opened("free")
  expect(free.layout()).toEqual([[[1], [2], [3], [4], [5], [6], [7]], []])
  expect(free.state.list[0].project).toBeUndefined()
  expect(free.state.list[0].own).toBeUndefined()
  // The row, and solo, its view: the Project's own Group, the Thread last
  // on its workspace, what is opened from it in its Group, another
  // Project's on its own workspace, one of no Project right of the Pane in
  // front, and what is opened for an Agent last on its Project's.
  for (const flow of ["row", "solo"] as const) {
    const window = opened(flow)
    expect(window.layout()).toEqual([[[1], [2], [3], [4], [7]], [[5], [6]], []])
    const [mine, theirs] = window.state.list
    expect([mine.project, theirs.project]).toEqual([A, B])
    const groups = mine.columns.map((column) => column.group)
    expect(groups[0]).toBe(mine.own)
    expect(groups[1]).toBe(mine.own)
    expect(groups[2]).not.toBe(mine.own)
    expect(groups[3]).toBe(groups[2])
    expect(groups[4]).toBeUndefined()
    expect(theirs.columns.map((column) => column.group)).toEqual([
      theirs.own,
      undefined,
    ])
  }
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
  // As the engine places them: a terminal of a Project on its workspace,
  // a draft's Thread on the top free one, and its terminal beside it.
  const window = windowIn("row", [NONE])
  const open = (project: ProjectId, pane: PaneState) =>
    window.change((w, placing) =>
      placed(w, project, pane, placing, { again: true })
    )
  open(A, terminal(1))
  open(NONE, { kind: "agents.thread", args: { n: 2 } })
  open(NONE, terminal(3))
  expect(window.layout()).toEqual([[[1]], [[2], [3]], []])
  expect(window.state.list[1].project).toBeUndefined()
})

test("a draft moved to another Project says so and names no place: the engine has it leave a workspace that is not its Project's, in the row and solo, and take its place on a free one or in the Flow free (ADR 0102, decision 3)", () => {
  const draft = (n: number): PaneState => ({
    kind: "agents.thread",
    args: { harness: "fake", n },
  })
  const moving = (flow: Flow) => {
    const window = windowIn(flow, [NONE])
    const open = (pane: PaneState, how = {}) =>
      window.change((w, placing) =>
        placed(w, A, pane, placing, { again: true, ...how })
      )
    const first = open(draft(1))!
    // The picker in the draft moves it to another Project.
    const move = (from: string, project: ProjectId, pane: PaneState) =>
      window.change((w, placing) => {
        const step = openingFrom(w, project, pane, placing, from, "instead")
        expect(paramsOf(step)).toMatchObject({ instead: from, moved: true })
        expect(paramsOf(step)).not.toHaveProperty("place")
        return step
      })
    return { window, first, move }
  }
  for (const flow of ["row", "solo"] as const) {
    const { window, first, move } = moving(flow)
    // To Brand: on Brand's workspace, and the window follows it there.
    const brand = move(first, B, draft(1))!
    expect(window.layout()).toEqual([[], [[1]], []])
    expect(window.state.list[1].project).toBe(B)
    expect(focused(window.state)?.id).toBe(brand)
    expect(window.state.current).toBe(1)
    // To No Project: the top free workspace.
    move(brand, NONE, draft(1))
    expect(window.layout()).toEqual([[], [], [[1]], []])
    expect(window.state.list[2].project).toBeUndefined()
    // On a free workspace it changes Project where it stands.
    move(focused(window.state)!.id, A, draft(1))
    expect(window.layout()).toEqual([[], [], [[1]], []])
  }
  // In the Flow free, in place.
  const { window, first, move } = moving("free")
  move(first, B, draft(1))
  expect(window.layout()).toEqual([[[1]], []])

  // Its first message makes it its Thread, another thing, in a scratch
  // Project not listed yet: in place, and so in its own Project.
  const row = placingOf("row", [])
  const state = open(start(), "work", draft(1), { place: "right" })
  const from = focused(state)!.id
  const sent = openingFrom(state, "scratch", thread("t1"), row, from, "instead")
  expect(paramsOf(sent)).toMatchObject({ project: "scratch", instead: from })
  expect(paramsOf(sent)).not.toHaveProperty("moved")
  const same = openingFrom(state, "work", draft(1), row, from, "instead")
  expect(paramsOf(same)).not.toHaveProperty("moved")
  // From one in no workspace, as the drawer's: beside the Pane in focus.
  const drawer = openingFrom(state, "brand", draft(1), row, "", "instead")
  expect(paramsOf(drawer)).not.toHaveProperty("moved")
})

test("pane.pick takes a Project and a Pane, as an Item carries it, and goes to it on its Project's machine once what lies over the Panes went (ADR 0087, decision 7)", () => {
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

  // A pick takes away what lies over the Panes, even to the Pane in
  // focus (ADR 0102, decision 5), and goes to the Pane as it opens on its
  // Project's machine, the one change that brings it to the left.
  const reach = vi.fn()
  const uncover = vi.fn(() => true)
  const tiling = tilingOf({
    reach,
    uncover,
    paneOn: (_, picked) => ({
      ...picked,
      args: { ...picked.args, host: "arc" },
    }),
    placing: () => placingOf("row", []),
  })
  run(tiling, "pane.pick", { project: "project-a", pane })
  run(tiling, "pane.pick", { project: "project-a" })
  expect(uncover).toHaveBeenCalledOnce()
  expect(reach).toHaveBeenCalledOnce()
  const [how] = reach.mock.calls[0] as [Change]
  expect(paramsOf(how(start()))).toMatchObject({
    project: "project-a",
    kind: pane.kind,
    args: { thread: "t1", host: "arc" },
  })
})

test("pane.close takes away what lies over the Panes while it shows, else closes the Pane in focus; pane.new opens the launcher where the Person is, for the engine to place", () => {
  const state = open(start(), "project-a", thread("t1"), { place: "right" })
  const steps: Step[] = []
  const over = { shows: true }
  const tiling = tilingOf({
    change: (how) => void steps.push(how(state)),
    uncover: () => over.shows,
    here: { get: () => ({ project: "project-b" }) } as Tiling["here"],
    placing: () => placingOf("row", []),
  })
  run(tiling, "pane.close")
  expect(steps).toEqual([])
  over.shows = false
  run(tiling, "pane.close")
  expect(steps).toEqual([closing(focused(state)!.id)])

  run(tiling, "pane.new")
  const asked = paramsOf(steps[1])
  expect(asked).toMatchObject({
    project: "project-b",
    kind: "window.launcher",
    again: true,
    from: focused(state)!.id,
  })
  expect(asked).not.toHaveProperty("place")
})

test("pane.put-away closes every Pane that shows the Item, on any workspace, and no other (ADR 0069)", () => {
  const right = { place: "right" } as const
  let state = open(start(), "project-a", thread("t1"), right)
  state = open(state, "project-a", thread("t2"), right)
  state = open(fresh(state), "project-a", thread("t1"), {
    ...right,
    again: true,
  })
  const [first, , third] = entries(state)
  // Each close is worked out from what the last one left.
  const closed: string[] = []
  const tiling = tilingOf({
    drawn: () => state,
    change: (how) => {
      const step = how(state)
      if (!step || !("command" in step)) return
      const { pane } = step.command.params as { pane: string }
      closed.push(pane)
      state = {
        ...state,
        list: state.list.map((workspace) => ({
          ...workspace,
          columns: workspace.columns.filter((c) => c.entries[0]!.id !== pane),
        })),
      }
    },
  })
  run(tiling, "pane.put-away", { project: "project-a", item: "t1" })
  expect(closed).toEqual([first!.id, third!.id])
  const halves: (Args | undefined)[] = [
    undefined,
    { project: "project-a" },
    { item: "t1" },
  ]
  for (const args of halves) run(tiling, "pane.put-away", args)
  run(tiling, "pane.put-away", { project: "project-b", item: "t2" })
  expect(closed).toHaveLength(2)
})

test("workspace.go goes to a workspace by its place, past the ninth too, and only a number on the Bar runs it: unlisted, with no key", () => {
  let state = start()
  for (let n = 1; n <= 11; n++)
    state = open(fresh(state), "project-a", thread(`t${n}`), { place: "right" })
  const change = vi.fn((how: Change) => {
    state = (how(state) as Workspaces | undefined) ?? state
  })
  const tiling = tilingOf({ change })

  run(tiling, "workspace.go", { index: 10 })
  expect(state.current).toBe(10)
  expect(focused(state)?.pane).toEqual(thread("t11"))
  run(tiling, "workspace.go", { index: 0 })
  expect(focused(state)?.pane).toEqual(thread("t1"))
  // Not a place: nothing moves.
  const wrong: (Args | undefined)[] = [
    undefined,
    {},
    { index: "3" },
    { index: 1.5 },
  ]
  for (const args of wrong) run(tiling, "workspace.go", args)
  expect(change).toHaveBeenCalledTimes(2)

  const action = TILING_ACTIONS.find((action) => action.id === "workspace.go")
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
  const row = placingOf("row", [])
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
  const row = placingOf("row", [])
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

test("Alt+Shift+N onto another Project's workspace is the engine's to refuse in the row, in the window's words, and moves in the free Flow (ADR 0102, decision 6; ADR 0110, decision 8)", () => {
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
    const tiling = tilingOf({
      change: (how: (w: Workspaces) => unknown) => (step = how(state)),
      projectOf: lookupOf(projectsOf({ a: "Banda", b: "Brand" })),
      placing: () => placingOf(flow, []),
    })
    run(tiling, "pane.send-2")
    return step
  }
  toasted.mockClear()
  // The window asks all the same, and says nothing of its own: what its
  // copy of the rule foresees refused leaves the view where it is.
  const asked = sent("row")
  expect(asked).toMatchObject({
    command: { method: "workspaces.move_pane", params: { pane: "e" } },
    focus: false,
  })
  expect(toasted).not.toHaveBeenCalled()
  // Another refusal, as of a Pane gone since, is not the row's.
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
  refuse(asked, "not_found")
  expect(warned).toHaveBeenCalled()
  warned.mockRestore()
  expect(toasted).not.toHaveBeenCalled()
  // Once the engine refuses it, the window says whose the workspace is,
  // and where Banda's Panes go.
  refuse(asked)
  expect(toasted).toHaveBeenCalledWith("Workspace 2 is Brand's", {
    id: expect.any(String),
    description: "Banda's Panes go to its workspace, a free one or a new one.",
  })
  // In the Flow free the copy foresees no refusal, and the Pane is
  // followed where it goes.
  expect(sent("free")).toMatchObject({ want: "e" })
  expect(sent("free")).not.toHaveProperty("refused")
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

test("a refused move names the workspace by its number before the move, though the free one it leaves goes; a draft in the machine's own ID hears it is of no Project, as a scratch Project's Thread does (ADR 0102, decisions 1 and 6)", () => {
  inFlow("row")
  const terminal = { kind: "terminal.terminal", args: {} }
  const one = (id: string, project: string, pane: PaneState = terminal) => ({
    id: `${id}-c`,
    active: 0,
    entries: [{ id, project, pane }],
  })
  // Banda's, then a free one with only a Thread of no Project, on screen,
  // then Brand's.
  const on = (project: string): Workspaces => ({
    list: [
      { id: "mine", project: "a", focus: 0, columns: [one("e", "a")] },
      { id: "free", focus: 0, columns: [one("t", project, thread("t1"))] },
      { id: "theirs", project: "b", focus: 0, columns: [one("f", "b")] },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 1,
  })
  const projects = projectsOf({ a: "Banda", b: "Brand", s: "" }, ["s"])
  // A scratch Project's Thread, and a draft in the machine's own ID, which
  // the window knows no summary of.
  for (const project of ["s", "machine"]) {
    const tiling = tilingOf({
      change: (how: (w: Workspaces) => unknown) => refuse(how(on(project))),
      projectOf: lookupOf(projects),
      placing: () => placingOf("row", noProjectOf(projects, "machine")),
    })
    for (const action of ["pane.send-3", "pane.move-down-or-to-workspace"]) {
      toasted.mockClear()
      run(tiling, action)
      expect(toasted).toHaveBeenCalledWith("Workspace 3 is Brand's", {
        id: expect.any(String),
        description:
          "A Pane of no Project goes to a free workspace or a new one.",
      })
    }
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
    const tiling = tilingOf({
      change: (how: (w: Workspaces) => unknown) => (step = how(state)),
      projectOf: () => undefined,
      placing: () => placingOf("row", []),
    })
    run(tiling, "pane.send-2")
    return step
  }
  expect(sent(on(1))).toMatchObject({
    command: { method: "workspaces.move_pane", params: { pane: "x2-e" } },
  })
  expect(sent(on(2))).toMatchObject({
    command: { method: "workspaces.move_group", params: { column: "t1" } },
  })
})

test("Open beside brings a Thread onto a free workspace or its Project's; onto another Project's in the row the engine refuses it, in the window's words (ADR 0102, decision 6; ADR 0110, decision 8)", () => {
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
  const row = placingOf("row", noProjectOf(projects, "machine"))
  toasted.mockClear()
  // It says it brings the Pane, so the engine refuses it as a move, and
  // the window says nothing until it does.
  const brought = bringing(on("b"), "a", pane, row, projectOf)
  expect(paramsOf(brought)).toMatchObject({ brought: true, again: true })
  expect(toasted).not.toHaveBeenCalled()
  refuse(brought)
  expect(toasted).toHaveBeenCalledWith("Workspace 1 is Brand's", {
    id: expect.any(String),
    description: "Banda's Panes go to its workspace, a free one or a new one.",
  })
  // Where the engine lets it go, the copy foresees no refusal.
  for (const owner of [undefined, "a"]) {
    const let_go = bringing(on(owner), "a", pane, row, projectOf)
    expect(paramsOf(let_go)).toMatchObject({ brought: true })
    expect(let_go).not.toHaveProperty("refused")
  }
  // A Thread of no Project hears where it goes: a free workspace. So does
  // a draft in the machine's own ID, which has no summary.
  for (const none of ["s", "machine"]) {
    toasted.mockClear()
    refuse(bringing(on("b"), none, pane, row, projectOf))
    expect(toasted).toHaveBeenCalledWith("Workspace 1 is Brand's", {
      id: expect.any(String),
      description:
        "A Pane of no Project goes to a free workspace or a new one.",
    })
  }
  // In the Flow free, every workspace is free.
  const free = placingOf("free", noProjectOf(projects))
  expect(bringing(on("b"), "a", pane, free, projectOf)).not.toHaveProperty(
    "refused"
  )
  // One another workspace shows moves here, and is refused as any move.
  const elsewhere: Workspaces = {
    list: [
      ...on("b").list.slice(0, 1),
      {
        id: "mine",
        project: "a",
        focus: 0,
        columns: [
          { id: "d", active: 0, entries: [{ id: "t", project: "a", pane }] },
        ],
      },
      { id: "bottom", columns: [], focus: 0 },
    ],
    current: 0,
  }
  toasted.mockClear()
  const moved = bringing(elsewhere, "a", pane, row, projectOf)
  expect(moved).toMatchObject({
    command: { method: "workspaces.move_pane", params: { pane: "t" } },
    focus: false,
  })
  // The window stays where it is while the engine says no: `focus`.
  refuse(moved)
  expect(toasted).toHaveBeenCalledWith("Workspace 1 is Brand's", {
    id: expect.any(String),
    description: "Banda's Panes go to its workspace, a free one or a new one.",
  })
})

test("pane.beside brings what an Item carries beside the Pane in focus, and what lies over the Panes goes (ADR 0098, decision 14)", () => {
  // Open beside, by its key: the Sheet goes, and the Pane comes onto a
  // workspace as the menu's row brings it; without a Pane, nothing.
  const pane = thread("t1")
  const projects = projectsOf({ a: "Banda" })
  const change = vi.fn()
  const uncover = vi.fn(() => true)
  const tiling = tilingOf({
    change,
    uncover,
    placing: () => placingOf("free", noProjectOf(projects)),
    projectOf: lookupOf(projects),
  })
  run(tiling, "pane.beside", { project: "a", pane })
  run(tiling, "pane.beside", { project: "a" })
  expect(uncover).toHaveBeenCalledOnce()
  expect(change).toHaveBeenCalledOnce()
  const [how] = change.mock.calls[0] as [Change]
  const empty: Workspaces = {
    list: [{ id: "bottom", columns: [], focus: 0 }],
    current: 0,
  }
  expect(how(empty)).toEqual(
    bringing(empty, "a", pane, tiling.placing(), tiling.projectOf)
  )
  expect(how(empty)).toBeDefined()
})

test("Arrange by Project names every Project its Panes are of, as a Pane opens, and with one Project only it (ADR 0102, decisions 7 and 9)", () => {
  const projects = [
    { id: "a", scratch: false },
    { id: "s", scratch: true },
  ] as unknown as ProjectSummary[]
  const right = { place: "right" } as const
  // `far` is not in this machine's list: another machine's Project, or one
  // whose folder is missing. It has a workspace of its own all the same.
  let state = open(start(), "far", thread("t1"), right)
  state = open(state, "a", { kind: "terminal.shell", args: {} }, right)
  state = open(state, "s", thread("t2"), right)
  // A draft in the machine's own ID, as a new Thread in No Project starts.
  state = open(state, "m", thread("t3"), right)
  const placing = placingOf("row", noProjectOf(projects, "m"))
  const arranged = arranging(state, placing)
  // A Group goes as its lead says: the kinds of Pane that open grouped.
  const leads = ["agents.thread"]
  expect(arranged.command).toEqual({
    method: "workspaces.arrange",
    params: { projects: ["far", "a"], leads },
  })
  // The Pane in front goes along.
  expect(arranged.want).toBe(focused(state)?.id)
  expect(arranging(state, placing, "a").command.params).toEqual({
    projects: ["far", "a"],
    leads,
    only: "a",
  })
  // What the Placing says is of no Project, as the machine's own, is not.
  const none: Placing = {
    ...placing,
    scratch: (project) => project === "far" || placing.scratch(project),
  }
  expect(arranging(state, none).command.params).toEqual({
    projects: ["a"],
    leads,
  })
})

test("a first Pane started on an emptied Project's workspace goes where the keys put it, into its own Group, and on one of no Project there (ADR 0102, decision 4)", () => {
  const started = (flow: Flow) => {
    const window = windowIn(flow)
    // A's workspace, emptied, and the empty one at the bottom.
    const first = window.change((w, placing) =>
      placed(w, A, { kind: "agents.thread", args: { n: 1 } }, placing)
    )!
    window.change(() => ({
      command: { method: "workspaces.close", params: { pane: first } },
    }))
    return window
  }
  const row = started("row")
  expect(row.state.list.map((w) => w.project)).toEqual([A, undefined])
  // On the Project's, in its Project: asked of the engine, as a key's.
  const asked = startingHere(row.state, B, terminal(2), placingOf("row", []))
  expect(paramsOf(asked)).toEqual({
    project: A,
    kind: "terminal.terminal",
    args: { n: 2 },
    again: true,
    on: row.state.list[0].id,
  })
  row.change((w, placing) => startingHere(w, B, terminal(2), placing))
  expect(row.layout()).toEqual([[[2]], []])
  expect(row.state.list[0].columns[0].group).toBe(row.state.list[0].own)
  // On the empty one at the bottom, a column there, in the home Project.
  row.change((w) => ({ ...w, current: 1 }))
  const bottom = row.state.list[1].id
  const there = startingHere(row.state, B, terminal(3), placingOf("row", []))
  expect(paramsOf(there)).toMatchObject({
    project: B,
    place: { to: "column", workspace: bottom, index: 0 },
  })
  // In the Flow free, there too, in its Project.
  const free = started("free")
  free.change((w, placing) => startingHere(w, B, terminal(2), placing))
  expect(free.layout()).toEqual([[[2]], []])
  expect(free.state.list[0].columns[0].group).toBeUndefined()
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
    const tiling = tilingOf({
      change: (how: (w: Workspaces) => Workspaces | Plan | undefined) => {
        const step = how(state)
        if (step && "command" in step) sent.push(step.command)
        else if (step) state = step
      },
      here: {
        get: () => ({ workspace: { id: state.list[state.current]!.id } }),
      } as Tiling["here"],
    })
    const close = (args?: Args) => {
      run(tiling, "workspace.close", args)
      return { at: state.current, sent: [...sent] }
    }
    return close
  }
  const tidy = (keep: string, projects: string[]) => ({
    method: "workspaces.tidy",
    params: { keep, projects },
  })

  toasted.mockClear()
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
  expect(toasted).not.toHaveBeenCalled()
  // One that holds a Pane, the empty one at the bottom: nothing, and a
  // quiet toast says why.
  expect(closing([busy, mine, bottom], 0)()).toEqual({ at: 0, sent: [] })
  expect(toasted).toHaveBeenLastCalledWith("Workspace 1 holds Panes", {
    id: expect.any(String),
    description:
      "Only an empty workspace closes. Close or move its Panes first.",
  })
  expect(closing([busy, mine, bottom], 2)()).toEqual({ at: 2, sent: [] })
  expect(toasted).toHaveBeenLastCalledWith(
    "The empty workspace at the bottom stays",
    {
      id: expect.any(String),
      description: "It is where a new workspace starts.",
    }
  )
  // One gone already, as a second press of its cross finds it, says
  // nothing.
  toasted.mockClear()
  expect(closing([busy, bottom], 0)({ workspace: "mine" })).toEqual({
    at: 0,
    sent: [],
  })
  expect(toasted).not.toHaveBeenCalled()

  // In the Banda menu, with no key: a held Alt+W would go on to close
  // the Panes of the workspace it goes to.
  const action = TILING_ACTIONS.find(
    (action) => action.id === "workspace.close"
  )
  expect(action?.keys).toBeUndefined()
  expect(action?.unlisted).toBeUndefined()
})
