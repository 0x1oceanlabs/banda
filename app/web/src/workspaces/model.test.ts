import type { PaneState } from "@banda/ui/pane"
import { describe, expect, test } from "vitest"
import {
  close,
  current,
  entries,
  focused,
  go,
  left,
  move,
  open,
  parse,
  send,
  shift,
  shown,
  start,
  step,
  update,
  widen,
  type Workspaces,
} from "./model"

const A = "space-a"
const B = "space-b"
const thread = (id: string): PaneState => ({
  kind: "agents.thread",
  args: { thread: id },
})
const terminal = (id: string): PaneState => ({
  kind: "terminal.terminal",
  args: { terminal: id },
})

/** What a workspace shows, column by column: each Pane's first arg. */
function columns(state: Workspaces, index = state.current): string[][] {
  return state.list[index].columns.map((column) =>
    column.entries.map((entry) => String(Object.values(entry.pane.args)[0]))
  )
}

function focusName(state: Workspaces): string | undefined {
  const entry = focused(state)
  return entry && String(Object.values(entry.pane.args)[0])
}

describe("a start", () => {
  test("is one empty workspace", () => {
    const state = start()
    expect(state.list).toHaveLength(1)
    expect(focused(state)).toBeUndefined()
    expect(shown(state)).toEqual([0])
  })
})

describe("opening", () => {
  test("adds a column on the right and focuses it", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    expect(columns(state)).toEqual([["t1"], ["x1"]])
    expect(focusName(state)).toBe("x1")
  })

  test("a new column sits right of the opener, not at the end", () => {
    let state = open(start(), A, thread("t1"))
    const first = focused(state)!.id
    state = open(state, A, terminal("x1"), { place: "right" })
    state = open(state, A, terminal("x2"), { from: first, place: "right" })
    expect(columns(state)).toEqual([["t1"], ["x2"], ["x1"]])
  })

  test("below stacks the Pane under its opener, in the same column", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "below" })
    expect(columns(state)).toEqual([["t1", "x1"]])
    expect(focusName(state)).toBe("x1")
  })

  test("here replaces the opener's Pane", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "here" })
    expect(columns(state)).toEqual([["x1"]])
  })

  test("with no place, a Pane takes the place of one of its kind", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    state = open(state, B, thread("t2"))
    expect(columns(state)).toEqual([["t2"], ["x1"]])
    expect(focusName(state)).toBe("t2")
  })

  test("a Pane already shown gets the focus, on its own workspace", () => {
    let state = open(start(), A, thread("t1"))
    state = send(open(state, A, terminal("x1"), { place: "right" }), 5)
    expect(state.current).toBe(1)
    state = open(state, A, thread("t1"))
    expect(state.current).toBe(0)
    expect(focusName(state)).toBe("t1")
    expect(entries(state)).toHaveLength(2)
  })

  test("the same Pane in another Space is another Pane", () => {
    let state = open(start(), A, terminal("x1"))
    state = open(state, B, terminal("x1"), { place: "right" })
    expect(columns(state)).toEqual([["x1"], ["x1"]])
  })

  test("keeps the column's width", () => {
    const state = open(start(), A, thread("t1"), { width: "1/3" })
    expect(current(state).columns[0].width).toBe("1/3")
  })
})

describe("the empty workspace at the bottom", () => {
  test("is there once a workspace holds a Pane", () => {
    const state = open(start(), A, thread("t1"))
    expect(state.list).toHaveLength(2)
    expect(state.list[1].columns).toEqual([])
  })

  test("keeps its identity while the list changes above it", () => {
    let state = open(start(), A, thread("t1"))
    const spare = state.list[1].id
    state = open(state, A, terminal("x1"), { place: "right" })
    expect(state.list[1].id).toBe(spare)
  })

  test("an empty workspace in the middle goes once the Person leaves it", () => {
    let state = open(start(), A, thread("t1"))
    state = send(state, 1)
    // Workspace 1 is empty now, and current no longer: it went.
    expect(state.list).toHaveLength(2)
    expect(columns(state, 0)).toEqual([["t1"]])
    expect(state.current).toBe(0)
  })

  test("the current empty one stays until the Person leaves it", () => {
    let state = open(start(), A, thread("t1"))
    state = go(state, 1)
    expect(state.current).toBe(1)
    expect(state.list).toHaveLength(2)
    state = step(state, -1)
    expect(state.current).toBe(0)
    expect(state.list).toHaveLength(2)
  })
})

describe("moving between workspaces", () => {
  test("goes by number; past the last, to the empty one", () => {
    let state = open(start(), A, thread("t1"))
    state = go(state, 8)
    expect(state.current).toBe(1)
    expect(shown(state)).toEqual([0, 1])
  })

  test("steps up and down, and stops at the ends", () => {
    let state = open(start(), A, thread("t1"))
    expect(step(state, -1)).toBe(state)
    state = step(state, 1)
    expect(state.current).toBe(1)
    expect(step(state, 1)).toBe(state)
  })

  test("sends the focused Pane to another workspace and follows it", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    state = send(state, 1)
    expect(state.current).toBe(1)
    expect(columns(state, 0)).toEqual([["t1"]])
    expect(columns(state, 1)).toEqual([["x1"]])
    expect(state.list).toHaveLength(3)
    expect(focusName(state)).toBe("x1")
  })
})

describe("focus and moves inside a workspace", () => {
  const three = () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    state = open(state, A, terminal("x2"), { place: "below" })
    return state
  }

  test("sideways goes between columns, up and down inside one", () => {
    let state = three()
    expect(focusName(state)).toBe("x2")
    state = move(state, "up")
    expect(focusName(state)).toBe("x1")
    state = move(state, "left")
    expect(focusName(state)).toBe("t1")
    expect(move(state, "left")).toBe(state)
    state = move(state, "right")
    expect(focusName(state)).toBe("x1")
  })

  test("a sideways move swaps whole columns", () => {
    const state = shift(three(), "left")
    expect(columns(state)).toEqual([["x1", "x2"], ["t1"]])
    expect(focusName(state)).toBe("x2")
  })

  test("an up or down move swaps Panes in the column", () => {
    const state = shift(three(), "up")
    expect(columns(state)).toEqual([["t1"], ["x2", "x1"]])
    expect(focusName(state)).toBe("x2")
  })

  test("widths step and stop at the ends", () => {
    let state = open(start(), A, thread("t1"))
    state = widen(state, 1)
    expect(current(state).columns[0].width).toBe("2/3")
    state = widen(widen(state, 1), 1)
    expect(current(state).columns[0].width).toBe("1")
    state = widen(widen(widen(widen(state, -1), -1), -1), -1)
    expect(current(state).columns[0].width).toBe("1/3")
  })

  test("widths step through the look's presets, from any width", () => {
    const presets = ["1/4", "3/5", "1"]
    let state = open(start(), A, thread("t1"), { width: "1/2" })
    state = widen(state, 1, presets)
    expect(current(state).columns[0].width).toBe("3/5")
    state = widen(widen(state, -1, presets), -1, presets)
    expect(current(state).columns[0].width).toBe("1/4")
    // A width kept from before, such as 2/5, survives a reload.
    const kept = open(start(), A, thread("t2"), { width: "2/5" })
    const back = parse(JSON.parse(JSON.stringify(kept)))!
    expect(current(back).columns[0].width).toBe("2/5")
  })
})

describe("closing", () => {
  test("drops an emptied column and focuses its neighbour", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    state = open(state, A, terminal("x2"), { place: "right" })
    state = move(state, "left")
    state = close(state, focused(state)!.id)
    expect(columns(state)).toEqual([["t1"], ["x2"]])
    expect(focusName(state)).toBe("t1")
  })

  test("in a column, focuses the Pane that took its place", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "below" })
    state = close(state, focused(state)!.id)
    expect(columns(state)).toEqual([["t1"]])
    expect(focusName(state)).toBe("t1")
  })

  test("the last Pane of a workspace leaves it empty and current", () => {
    let state = open(start(), A, thread("t1"))
    state = close(state, focused(state)!.id)
    expect(state.list).toHaveLength(1)
    expect(focused(state)).toBeUndefined()
  })

  test("tells which Panes left every workspace", () => {
    let before = open(start(), A, thread("t1"))
    before = open(before, A, terminal("x1"), { place: "right" })
    const after = close(before, focused(before)!.id)
    expect(left(before, after).map((entry) => entry.pane)).toEqual([
      terminal("x1"),
    ])
    expect(left(before, send(before, 1))).toEqual([])
  })
})

describe("new args", () => {
  test("keep the Pane where it is", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    const id = focused(state)!.id
    state = update(state, id, terminal("x9"))
    expect(columns(state)).toEqual([["t1"], ["x9"]])
  })
})

describe("what was kept", () => {
  test("comes back as it was", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "below", width: "1/3" })
    const back = parse(JSON.parse(JSON.stringify(state)))
    expect(back).toEqual(state)
  })

  test("is refused when it is not workspaces", () => {
    expect(parse(null)).toBeNull()
    expect(parse({ list: [], current: 0 })).toBeNull()
    expect(
      parse({
        list: [{ id: "w", columns: [{ id: "c", entries: [{ id: 1 }] }] }],
        current: 0,
      })
    ).toBeNull()
  })

  test("gets its empty workspace at the bottom back", () => {
    const one = open(start(), A, thread("t1"))
    const back = parse({ list: [one.list[0]], current: 0 })!
    expect(back.list).toHaveLength(2)
    expect(back.list[1].columns).toEqual([])
  })
})
