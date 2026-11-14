import type { Engine, Event, ProjectId } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { describe, expect, test } from "vitest"
import {
  applyChange,
  closingWorkspace,
  columnMoved,
  keptOf,
  moved,
  NO_VIEW,
  opened,
  resized,
  resolve,
  send as sendToEngine,
  tidied,
  tidiedInFront,
  viewOf,
  withAsked,
  workspaceMoved,
} from "./arrange"
import { apply } from "./arrangement"
import {
  close,
  current,
  deck,
  even,
  focused,
  heighten,
  maximize,
  open,
  send,
  shift,
  start,
  step,
  widen,
  type Workspaces,
} from "./model"

const A = "project-a"

function pane(kind: string, args: Record<string, string> = {}): PaneState {
  return { kind, args } as PaneState
}

/** Two columns on the first workspace, the second a stack of two. */
function arranged(): Workspaces {
  let state = open(start(), A, pane("a.one"), { place: "right" })
  state = open(state, A, pane("a.two"), { place: "right" })
  state = open(state, A, pane("a.three"), { place: "below" })
  return state
}

/** The state the window draws once the engine keeps `state`. */
function drawn(state: Workspaces): Workspaces {
  return resolve(keptOf(state), viewOf(state))
}

function event(seq: number, payload: unknown): Event {
  return {
    seq,
    id: `event-${seq}`,
    module: "workspaces",
    kind: "changed",
    version: 1,
    subject: null,
    author: { kind: "person", id: "me" },
    at: 0,
    payload,
  } as unknown as Event
}

describe("resolve", () => {
  test("draws the arrangement as the view looks at it", () => {
    const state = arranged()
    expect(drawn(state)).toEqual(state)
  })

  test("keeps what did not change the same object", () => {
    const state = arranged()
    const before = drawn(state)
    const after = resolve(keptOf(state), viewOf(state), before)
    expect(after.list[0]).toBe(before.list[0])
    expect(after.list[0].columns[1].entries[0]).toBe(
      before.list[0].columns[1].entries[0]
    )
  })

  test("a Pane closed in a stack leaves its place to the one after", () => {
    const state = arranged()
    const column = current(state).columns[1]
    const top = { ...state, list: [...state.list] }
    top.list[0] = {
      ...current(state),
      columns: [current(state).columns[0], { ...column, active: 0 }],
    }
    const gone = close(top, column.entries[0].id)
    const after = resolve(keptOf(gone), viewOf(top))
    expect(focused(after)?.pane.kind).toBe("a.three")
  })

  test("a column closed leaves the focus to the one before", () => {
    const state = arranged()
    const column = current(state).columns[1]
    let gone = close(state, column.entries[0].id)
    gone = close(gone, column.entries[1].id)
    const after = resolve(keptOf(gone), viewOf(state))
    expect(focused(after)?.pane.kind).toBe("a.one")
  })

  test("keeps the Agent that opened a Pane, both ways", () => {
    const before = arranged()
    const kept = keptOf(before)
    const pane = { ...kept[0].columns[0].panes[0], by: "agent-1" }
    kept[0].columns[0].panes[0] = pane
    const state = resolve(kept, viewOf(before))
    expect(state.list[0].columns[0].entries[0].by).toBe("agent-1")
    expect(keptOf(state)[0].columns[0].panes[0]).toEqual(pane)
    expect(state.list[0].columns[1].entries[0]).not.toHaveProperty("by")
  })

  test("looks at the Pane wanted once the arrangement stands past it", () => {
    const state = arranged()
    const one = current(state).columns[0].entries[0].id
    const view = { ...viewOf(state), want: { pane: one, after: 5 } }
    expect(focused(resolve(keptOf(state), view, undefined, 4))?.id).not.toBe(
      one
    )
    expect(focused(resolve(keptOf(state), view, undefined, 5))?.id).toBe(one)
  })
})

describe("viewOf", () => {
  test("holds the IDs and where they stand", () => {
    const state = arranged()
    const view = viewOf(state)
    const workspace = current(state)
    expect(view.current).toEqual({ id: workspace.id, at: 0 })
    expect(view.focus[workspace.id]).toEqual({
      id: workspace.columns[1].id,
      at: 1,
    })
    expect(view.want).toBeUndefined()
  })

  test("keeps the Pane wanted until the arrangement has shown it", () => {
    const state = arranged()
    const one = current(state).columns[0].entries[0].id
    const want = { pane: one, after: 5 }
    expect(viewOf(state, want, 4).want).toEqual(want)
    expect(viewOf(state, want, 5).want).toBeUndefined()
    expect(viewOf(start(), want, 5).want).toEqual(want)
  })

  test("of nothing is no view", () => {
    expect(resolve([], NO_VIEW)).toEqual({ list: [], current: 0 })
  })
})

describe("plans", () => {
  test("a Pane opened as a column, with its width", () => {
    const before = arranged()
    const next = open(before, A, pane("a.four"), {
      place: "right",
      width: "1/3",
    })
    const workspace = current(before).id
    expect(opened(before, next)?.command).toEqual({
      method: "workspaces.open",
      params: {
        project: A,
        kind: "a.four",
        args: {},
        again: true,
        place: { to: "column", workspace, index: 2 },
        width: "1/3",
      },
    })
  })

  test("a Pane opened under another, in its stack", () => {
    const before = arranged()
    const next = open(before, A, pane("a.four"), { place: "below" })
    const column = current(before).columns[1].id
    expect(opened(before, next)?.command.params).toMatchObject({
      place: { to: "stack", column, index: 2 },
    })
  })

  test("a Pane opened in the place of another, instead of it", () => {
    const before = arranged()
    const three = focused(before)?.id
    const next = open(before, A, pane("a.four"), { place: "instead" })
    expect(opened(before, next)?.command.params).toMatchObject({
      instead: three,
    })
    // A Group from its opening, either way, as a Thread is.
    expect(
      opened(before, next, { grouped: true })?.command.params
    ).toMatchObject({ instead: three, grouped: true })
  })

  test("a Pane shown already only changes the view", () => {
    const before = arranged()
    expect(opened(before, open(before, A, pane("a.one")))).toBeUndefined()
  })

  test("a Pane sent to another workspace moves there, and is wanted", () => {
    const before = arranged()
    const three = focused(before)?.id ?? ""
    const next = send(before, 1)
    expect(moved(next, three)).toEqual({
      command: {
        method: "workspaces.move_pane",
        params: {
          pane: three,
          place: { to: "column", workspace: next.list[1].id, index: 0 },
        },
      },
      want: three,
    })
  })

  test("a column shifted moves to its new index", () => {
    const before = arranged()
    const column = current(before).columns[1].id
    expect(columnMoved(shift(before, "left"), column)?.command).toEqual({
      method: "workspaces.move_column",
      params: { column, workspace: current(before).id, index: 0 },
    })
  })

  test("the workspace on screen moves up or down, never under the empty one", () => {
    // Two workspaces with Panes, on the second, and the empty one under.
    const state = send(arranged(), 1)
    expect(state.list.map((w) => w.columns.length)).toEqual([2, 1, 0])
    expect(workspaceMoved(state, -1)?.command).toEqual({
      method: "workspaces.move_workspace",
      params: { workspace: state.list[1].id, index: 0 },
    })
    expect(workspaceMoved(state, 1)).toBeUndefined()
    const first = step(state, -1)
    expect(workspaceMoved(first, -1)).toBeUndefined()
    expect(workspaceMoved(first, 1)?.command.params).toEqual({
      workspace: first.list[0].id,
      index: 1,
    })
    expect(workspaceMoved(step(state, 1), -1)).toBeUndefined()
  })

  test("the focused column's width, whole screen and display", () => {
    const before = arranged()
    const column = current(before).columns[1].id
    expect(resized(before, widen(before, 1))?.command.method).toBe(
      "workspaces.size"
    )
    expect(resized(before, maximize(before))?.command).toEqual({
      method: "workspaces.maximize",
      params: { column, full: true },
    })
    expect(resized(before, deck(before))?.command).toEqual({
      method: "workspaces.display",
      params: { column, display: "deck" },
    })
    expect(resized(before, before)).toBeUndefined()
  })

  test("a Pane's height, and the column even again", () => {
    const before = arranged()
    const three = focused(before)?.id
    const taller = heighten(before, 1)
    expect(resized(before, taller)?.command).toEqual({
      method: "workspaces.height",
      params: { pane: three, height: "2/3" },
    })
    const column = current(before).columns[1].id
    expect(resized(taller, even(taller))?.command).toEqual({
      method: "workspaces.even",
      params: { column },
    })
    // The engine's heights are drawn, each Pane anew only when it changed.
    const kept = keptOf(taller)
    expect(kept[0].columns[1].panes[1].height).toBe("2/3")
    const drawnBefore = drawn(before)
    const after = resolve(kept, viewOf(taller), drawnBefore)
    expect(after.list[0].columns[1].entries[1].height).toBe("2/3")
    expect(after.list[0].columns[1].entries[0]).toBe(
      drawnBefore.list[0].columns[1].entries[0]
    )
  })

  test("tidies only empty workspaces the Person has left", () => {
    const among =
      (...gone: ProjectId[]) =>
      (project: ProjectId) =>
        gone.includes(project)
    const state = arranged()
    expect(tidied(state)).toBeUndefined()
    const left: Workspaces = {
      list: [{ id: "empty", columns: [], focus: 0 }, ...state.list],
      current: 1,
    }
    expect(tidied(left)).toEqual({
      method: "workspaces.tidy",
      params: { keep: current(left).id },
    })
    // A Project's stays but when its Project is known to have no Threads
    // (ADR 0102, decision 2).
    const mine = "p1" as ProjectId
    const kept: Workspaces = {
      list: [
        { id: "mine", columns: [], focus: 0, project: mine },
        ...state.list,
      ],
      current: 1,
    }
    expect(tidied(kept)).toBeUndefined()
    expect(tidied(kept, among(mine))).toEqual({
      method: "workspaces.tidy",
      params: { keep: current(kept).id },
    })
    // One a draft in the machine's own ID came to own, before such a draft
    // went to a free one, goes once the window names it gone; in view, it
    // stays (ADR 0102, decision 1).
    const machine = "machine" as ProjectId
    const owned: Workspaces = {
      list: [
        { id: "owned", columns: [], focus: 0, project: machine },
        ...state.list,
      ],
      current: 1,
    }
    expect(tidied(owned, among(mine, machine))).toEqual({
      method: "workspaces.tidy",
      params: { keep: current(owned).id },
    })
    expect(tidied({ ...owned, current: 0 }, among(machine))).toBeUndefined()
    // With another empty one to let go, it is named to stay.
    const both: Workspaces = {
      list: [...kept.list.slice(0, 1), ...left.list],
      current: 2,
    }
    expect(tidied(both)).toEqual({
      method: "workspaces.tidy",
      params: { keep: current(both).id, projects: [mine] },
    })
    // In the Flow free every workspace is free: a Project's goes too, as
    // before ADR 0102 (decision 1).
    expect(tidied(kept, undefined, false)).toEqual(tidied(kept, among(mine)))
    expect(tidied(both, undefined, false)).toEqual({
      method: "workspaces.tidy",
      params: { keep: current(both).id },
    })
  })

  test("only the device in front tidies: a window behind never takes away the empty workspace the Person looks at on another device, and back in front it tidies then (ADR 0087, decision 10)", () => {
    // Two windows on one engine draw the same workspaces, each with its
    // own view: the Person, at the first, looks at an empty workspace,
    // and the second, behind, shows another.
    const state = arranged()
    const list = [{ id: "empty", columns: [], focus: 0 }, ...state.list]
    const first: Workspaces = { list, current: 0 }
    const second: Workspaces = { list, current: 1 }
    // The first keeps the one it shows, and the second sends nothing: its
    // tidy would name its own workspace to keep, and let `empty` go.
    expect(tidiedInFront(first, true)).toBeUndefined()
    expect(tidiedInFront(second, false)).toBeUndefined()
    // The Person comes to the second: it tidies then, as one window does.
    expect(tidiedInFront(second, true)).toEqual(tidied(second))
    expect(tidied(second)).toEqual({
      method: "workspaces.tidy",
      params: { keep: current(second).id },
    })
    // What stays and what goes is `tidied`'s still.
    const mine = "p1" as ProjectId
    const gone = (project: ProjectId) => project === mine
    const kept: Workspaces = {
      list: [
        { id: "mine", columns: [], focus: 0, project: mine },
        ...state.list,
      ],
      current: 1,
    }
    expect(tidiedInFront(kept, true)).toBeUndefined()
    expect(tidiedInFront(kept, true, gone)).toEqual(tidied(kept, gone))
    expect(tidiedInFront(kept, true, undefined, false)).toEqual(
      tidied(kept, undefined, false)
    )
    expect(tidiedInFront(kept, false, gone, false)).toBeUndefined()
  })

  test("closes an emptied workspace the window has left, a Project's too, and keeps the rest (ADR 0102, decision 2)", () => {
    const state = arranged()
    // As the engine names them, so its copy runs the command.
    const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
    const [mine, theirs] = [uuid(1), uuid(2)] as ProjectId[]
    const [busy, bottom] = state.list
    const closing: Workspaces = {
      list: [
        busy!,
        { id: uuid(3), columns: [], focus: 0, project: mine },
        { id: uuid(4), columns: [], focus: 0, project: theirs },
        bottom!,
      ],
      current: 0,
    }
    const command = closingWorkspace(closing, uuid(3))
    expect(command).toEqual({
      method: "workspaces.tidy",
      params: { keep: busy!.id, projects: [theirs] },
    })
    // As the engine runs it, that one goes alone.
    const after = apply(keptOf(closing), command!, uuid(5))
    expect("list" in after && after.list.map((one) => one.id)).toEqual([
      busy!.id,
      uuid(4),
      bottom!.id,
    ])
    // None while the window is on it, while it holds a Pane, for the
    // empty one at the bottom, or one that is not there.
    const there = { ...closing, current: 1 }
    expect(closingWorkspace(there, uuid(3))).toBeUndefined()
    expect(closingWorkspace(there, busy!.id)).toBeUndefined()
    expect(closingWorkspace(closing, bottom!.id)).toBeUndefined()
    expect(closingWorkspace(closing, uuid(6))).toBeUndefined()
  })
})

describe("applyChange", () => {
  test("takes the whole arrangement, or a Pane's new args", () => {
    const kept = keptOf(arranged())
    const whole = applyChange(
      { at: 0, workspaces: [], aside: null },
      event(3, { workspaces: kept })
    )
    expect(whole).toEqual({ at: 3, workspaces: kept, aside: null })
    const id = kept[0].columns[0].panes[0].id
    const args = applyChange(whole, event(4, { pane: id, args: { x: "y" } }))
    expect(args.at).toBe(4)
    expect(args.workspaces[0].columns[0].panes[0].args).toEqual({ x: "y" })
    expect(args.workspaces[0].columns[1]).toEqual(kept[0].columns[1])
  })

  test("hears what is set aside only as the workspaces are set aside or come back", () => {
    const kept = keptOf(arranged())
    const aside = { workspaces: 1, panes: 2 }
    const set = applyChange(
      { at: 0, workspaces: kept, aside: null },
      event(5, { workspaces: [], aside })
    )
    expect(set).toEqual({ at: 5, workspaces: [], aside })
    expect(applyChange(set, event(6, { workspaces: kept })).aside).toEqual(
      aside
    )
    const back = applyChange(set, event(7, { workspaces: kept, aside: null }))
    expect(back.aside).toBeNull()
  })
})

describe("withAsked", () => {
  test("draws the args asked for until the log stands at their event", () => {
    const kept = keptOf(arranged())
    const id = kept[0].columns[0].panes[0].id
    const asked = { [id]: { args: { x: "y" }, until: 7 } }
    const ahead = withAsked(kept, asked, 6)
    expect(ahead.kept[0].columns[0].panes[0].args).toEqual({ x: "y" })
    expect(ahead.kept[0].columns[1]).toEqual(kept[0].columns[1])
    expect(ahead.asked).toEqual(asked)
    const shown = withAsked(kept, asked, 7)
    expect(shown).toEqual({ kept, asked: {} })
    expect(shown.kept).toBe(kept)
  })
})

describe("send", () => {
  test("sends a change under the command ID given, which names what it makes", async () => {
    const sent: unknown[][] = []
    const engine = {
      commandAt: (...call: unknown[]) => (
        sent.push(call),
        Promise.resolve({ answer: {}, at: null })
      ),
    } as unknown as Engine
    const close = { method: "workspaces.close", params: { pane: "p" } } as const
    await sendToEngine(engine, close, "019a5b2e-3c4d-7e8f-9a0b-1c2d3e4f5a6b")
    await sendToEngine(engine, close)
    expect(sent).toEqual([
      [
        "workspaces.close",
        { pane: "p" },
        undefined,
        "019a5b2e-3c4d-7e8f-9a0b-1c2d3e4f5a6b",
      ],
      // Left out, the engine's client makes one.
      ["workspaces.close", { pane: "p" }, undefined, undefined],
    ])
  })
})
