import type { PaneState } from "@banda/ui/pane"
import { describe, expect, test } from "vitest"
import { DEFAULT_COLUMNS } from "@banda/contract/look"
import {
  bring,
  carry,
  close,
  consume,
  current,
  deck,
  displayOf,
  edge,
  entries,
  even,
  fill,
  focused,
  fresh,
  go,
  heighten,
  heightsOf,
  heightTo,
  left,
  maximize,
  move,
  open,
  parse,
  send,
  shift,
  inBar,
  start,
  step,
  toEdge,
  SIZES,
  type Width,
  widen,
  widthIn,
  type Workspaces,
} from "./model"

const A = "space-a"
const B = "space-b"

/** The widths the focused workspace's columns are drawn at. */
function widths(state: Workspaces, sizes = SIZES): Width[] {
  const workspace = current(state)
  return workspace.columns.map((column) => widthIn(workspace, column, sizes))
}

/** The focused column's width, as drawn. */
function width(state: Workspaces, sizes = SIZES): Width {
  return widths(state, sizes)[current(state).focus]
}

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
    expect(inBar(state)).toEqual([
      { id: state.list[0]!.id, index: 0, empty: true, bottom: true },
    ])
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

  test("a Pane its kind names the same shows the args asked, or keeps its own", () => {
    const diff = (scope: string): PaneState => ({
      kind: "git.diff",
      args: { scope },
    })
    const identity = (pane: PaneState): PaneState =>
      pane.kind === "git.diff" ? { kind: pane.kind, args: {} } : pane
    let state = open(start(), A, thread("t1"))
    state = open(state, A, diff("staged"), { place: "right" })
    const id = focused(state)!.id
    state = open(state, A, thread("t1"))
    // Kept: it only gets the focus, as Alt+D gives it.
    state = open(state, A, diff("changes"), {
      place: "right",
      identity,
      keep: true,
    })
    expect(columns(state)).toEqual([["t1"], ["staged"]])
    expect(focused(state)!.id).toBe(id)
    // Else the same tile shows the scope asked.
    state = open(state, A, thread("t1"))
    state = open(state, A, diff("changes"), { place: "right", identity })
    expect(columns(state)).toEqual([["t1"], ["changes"]])
    expect(focused(state)!.id).toBe(id)
    // Without it, the args decide.
    state = open(state, A, diff("staged"), { place: "right" })
    expect(columns(state)).toEqual([["t1"], ["changes"], ["staged"]])
  })

  test("again, the same Pane opens as a new tile each time, as New Thread does", () => {
    let state = open(start(), A, thread("new"))
    state = open(state, A, thread("new"), { place: "right", again: true })
    state = open(state, A, thread("new"), { place: "right", again: true })
    expect(columns(state)).toEqual([["new"], ["new"], ["new"]])
    expect(current(state).focus).toBe(2)
  })

  test("here, the Pane takes the opener's place though another shows it", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("launcher"), { place: "right" })
    state = open(state, A, thread("t1"), { place: "here" })
    expect(columns(state)).toEqual([["t1"], ["t1"]])
    expect(current(state).focus).toBe(1)
  })

  test("the same Pane in another Project is another Pane", () => {
    let state = open(start(), A, terminal("x1"))
    state = open(state, B, terminal("x1"), { place: "right" })
    expect(columns(state)).toEqual([["x1"], ["x1"]])
  })

  test("keeps the column's width", () => {
    const state = open(start(), A, thread("t1"), { width: "1/3" })
    expect(width(state)).toBe("1/3")
  })

  test("without the focus, the Pane shows and the focus stays", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right", focus: false })
    expect(columns(state)).toEqual([["t1"], ["x1"]])
    expect(focusName(state)).toBe("t1")
    // On another workspace, the Person stays where they are.
    state = send(state, 5)
    state = open(state, A, terminal("x1"), { focus: false })
    expect(state.current).toBe(1)
    expect(focusName(state)).toBe("t1")
    // A Pane shown already stays as it is.
    expect(open(state, A, terminal("x1"), { focus: false })).toBe(state)
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

  test("is the new workspace the bar's + goes to", () => {
    let state = open(start(), A, thread("t1"))
    state = fresh(state)
    expect(state.current).toBe(1)
    expect(inBar(state).at(-1)).toMatchObject({ index: 1, bottom: true })
    expect(fresh(state)).toBe(state)
    // From an empty one above others, it goes down, and the empty one
    // goes.
    state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    state = send(state, 1)
    state = go(state, 0)
    state = close(state, focused(state)!.id)
    expect(state.current).toBe(0)
    expect(state.list).toHaveLength(3)
    state = fresh(state)
    expect(columns(state, 0)).toEqual([["x1"]])
    expect(state.current).toBe(1)
    expect(state.list).toHaveLength(2)
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
    expect(inBar(state).map((w) => w.index)).toEqual([0, 1])
  })

  test("steps up and down, and stops at the ends", () => {
    let state = open(start(), A, thread("t1"))
    expect(step(state, -1)).toBe(state)
    state = step(state, 1)
    expect(state.current).toBe(1)
    expect(step(state, 1)).toBe(state)
  })

  test("carries a Pane past its column's end to the workspace there", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "below" })
    // Inside its column first, as shift does.
    state = carry(state, "up")
    expect(columns(state, 0)).toEqual([["x1", "t1"]])
    expect(carry(state, "up")).toBe(state)
    state = carry(state, "down")
    expect(columns(state, 0)).toEqual([["t1", "x1"]])
    state = carry(state, "down")
    expect(state.current).toBe(1)
    expect(columns(state, 0)).toEqual([["t1"]])
    expect(columns(state, 1)).toEqual([["x1"]])
    expect(focusName(state)).toBe("x1")
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
    let state = open(start(), A, thread("t1"), { width: "1/2" })
    state = widen(state, 1)
    expect(width(state)).toBe("2/3")
    state = widen(widen(state, 1), 1)
    expect(width(state)).toBe("1")
    state = widen(widen(widen(widen(state, -1), -1), -1), -1)
    expect(width(state)).toBe("1/3")
  })

  test("widths step through the look's presets, from any width", () => {
    const sizes = { ...SIZES, presets: ["1/4", "3/5", "1"] }
    let state = open(start(), A, thread("t1"), { width: "1/2" })
    state = widen(state, 1, sizes)
    expect(width(state)).toBe("3/5")
    state = widen(widen(state, -1, sizes), -1, sizes)
    expect(width(state)).toBe("1/4")
    // A width kept from before, such as 2/5, survives a reload.
    const kept = open(start(), A, thread("t2"), { width: "2/5" })
    const back = parse(JSON.parse(JSON.stringify(kept)))!
    expect(width(back)).toBe("2/5")
  })

  test("a column alone fills the screen; a second halves it, as the look says", () => {
    let state = open(start(), A, thread("t1"))
    expect(width(state)).toBe("1")
    state = open(state, A, terminal("x1"), { place: "right" })
    expect(widths(state)).toEqual(["1/2", "1/2"])
    // The look's own widths.
    const sizes = { ...SIZES, default: "1/3", alone: "2/3" }
    expect(widths(state, sizes)).toEqual(["1/3", "1/3"])
    // Alone again, it fills the screen again.
    state = close(state, focused(state)!.id)
    expect(width(state)).toBe("1")
    expect(width(state, sizes)).toBe("2/3")
    // A width the Person gave stays.
    state = open(widen(state, -1), A, terminal("x2"), { place: "right" })
    expect(widths(state)).toEqual(["2/3", "1/2"])
    // It survives a reload, as the look's does.
    expect(widths(parse(JSON.parse(JSON.stringify(state)))!)).toEqual([
      "2/3",
      "1/2",
    ])
  })

  test("widths step by what the window draws", () => {
    // A narrow window: 1/3, 1/2 and 2/3 are all drawn at the floor.
    const floor = 0.8
    let state = open(start(), A, thread("t1"), { width: "1/2" })
    expect(widen(state, -1, SIZES, { floor })).toBe(state)
    state = widen(state, 1, SIZES, { floor })
    expect(width(state)).toBe("1")
    state = widen(state, -1, SIZES, { floor })
    expect(width(state)).toBe("2/3")
    // Too narrow for any step to show: it stays.
    expect(widen(state, 1, SIZES, { floor: 1 })).toBe(state)
  })

  test("Alt+R goes round the widths", () => {
    let state = open(start(), A, thread("t1"), { width: "2/3" })
    state = widen(state, 1, SIZES, { wrap: true })
    expect(width(state)).toBe("1")
    state = widen(state, 1, SIZES, { wrap: true })
    expect(width(state)).toBe("1/3")
    state = widen(state, -1, SIZES, { wrap: true })
    expect(width(state)).toBe("1")
    // In a narrow window, round from the whole screen to the floor.
    state = widen(state, 1, SIZES, { wrap: true, floor: 0.8 })
    expect(width(state)).toBe("2/3")
  })

  test("a column takes the whole screen and gives it back", () => {
    let state = open(start(), A, thread("t1"), { width: "1/3" })
    state = maximize(state)
    expect(width(state)).toBe("1")
    const back = parse(JSON.parse(JSON.stringify(state)))!
    expect(width(maximize(back))).toBe("1/3")
    // A step from there goes on from the whole screen.
    state = widen(state, -1)
    expect(width(state)).toBe("2/3")
    expect(maximize(maximize(state))).toEqual(state)
  })
})

describe("heights, and the edges of a Strip", () => {
  const stacked = () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "below" })
    return open(state, A, terminal("x2"), { place: "below" })
  }
  const heights = (state: Workspaces) =>
    heightsOf(current(state).columns[current(state).focus]).map(
      (at) => Math.round(at * 100) / 100
    )

  test("a Pane steps its height; the others share what it leaves", () => {
    let state = stacked()
    expect(heights(state)).toEqual([0.33, 0.33, 0.33])
    state = heighten(state, 1)
    expect(focused(state)?.height).toBe("1/2")
    expect(heights(state)).toEqual([0.25, 0.25, 0.5])
    state = heighten(heighten(state, 1), 1)
    expect(focused(state)?.height).toBe("2/3")
    // Round, past the highest to the lowest.
    state = heighten(state, 1, DEFAULT_COLUMNS, { wrap: true })
    expect(focused(state)?.height).toBe("1/3")
    expect(heighten(state, -1)).toBe(state)
    state = even(heighten(state, 1))
    expect(heights(state)).toEqual([0.33, 0.33, 0.33])
    expect(
      current(state).columns[0].entries.every((e) => !("height" in e))
    ).toBe(true)
    expect(even(state)).toBe(state)
  })

  test("a Pane alone or in a Deck has no height of its own", () => {
    const alone = open(start(), A, thread("t1"))
    expect(heighten(alone, 1)).toBe(alone)
    expect(heightTo(alone, "1/2")).toBe(alone)
    const decked = deck(stacked())
    expect(heighten(decked, 1)).toBe(decked)
    expect(heightTo(decked, "1/2")).toBe(decked)
  })

  test("the Pane menu gives a Pane a height at once", () => {
    let state = heightTo(stacked(), "2/3")
    expect(focused(state)?.height).toBe("2/3")
    expect(heights(state)).toEqual([0.17, 0.17, 0.67])
    // The same height, or none, changes nothing.
    expect(heightTo(state, "2/3")).toBe(state)
    expect(heightTo(state, "wide")).toBe(state)
    state = heightTo(state, "1/3")
    expect(heights(state)).toEqual([0.33, 0.33, 0.33])
    expect(focused(state)?.height).toBe("1/3")
  })

  test("Home and End focus the edges, and with Shift move the column there", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, thread("t2"), { place: "right" })
    state = open(state, A, thread("t3"), { place: "right" })
    state = edge(state, "first")
    expect(focusName(state)).toBe("t1")
    expect(edge(state, "first")).toBe(state)
    state = toEdge(state, "last")
    expect(columns(state)).toEqual([["t2"], ["t3"], ["t1"]])
    expect(focusName(state)).toBe("t1")
    state = toEdge(edge(state, "first"), "last")
    expect(columns(state)).toEqual([["t3"], ["t1"], ["t2"]])
  })

  test("a column fills the room left, and leaves the whole screen", () => {
    const state = maximize(open(start(), A, thread("t1"), { width: "1/3" }))
    const filled = fill(state, "0.667")
    expect(width(filled)).toBe("0.667")
    expect(current(filled).columns[0].full).toBeUndefined()
    expect(fill(filled, "0.667")).toBe(filled)
  })
})

describe("groups", () => {
  const three = () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    return open(state, A, terminal("x2"), { place: "right" })
  }
  const display = (state: Workspaces, look = DEFAULT_COLUMNS) =>
    current(state).columns.map((column) => displayOf(column, look))

  test("Alt+[ and Alt+] take a Pane into the next column, and out again", () => {
    let state = consume(three(), "left")
    expect(columns(state)).toEqual([["t1"], ["x1", "x2"]])
    expect(focusName(state)).toBe("x2")
    state = consume(state, "left")
    expect(columns(state)).toEqual([["t1"], ["x2"], ["x1"]])
    expect(focusName(state)).toBe("x2")
    state = consume(consume(state, "left"), "right")
    expect(columns(state)).toEqual([["t1"], ["x2"], ["x1"]])
    expect(focusName(state)).toBe("x2")
    // At the end, nothing to take it into.
    const alone = open(start(), A, thread("t1"))
    expect(consume(alone, "left")).toBe(alone)
  })

  test("Alt+T shows a column as a Deck and back, as the look starts it", () => {
    let state = consume(three(), "left")
    expect(display(state)).toEqual(["stack", "stack"])
    state = deck(state)
    expect(display(state)).toEqual(["stack", "deck"])
    // The look's display holds for the columns not set.
    const decked = { ...DEFAULT_COLUMNS, display: "deck" as const }
    expect(display(state, decked)).toEqual(["deck", "deck"])
    expect(display(deck(state, decked), decked)).toEqual(["deck", "stack"])
    // It survives a reload, and a Deck kept by its old name is one.
    const back = parse(JSON.parse(JSON.stringify(state)))!
    expect(display(back)).toEqual(["stack", "deck"])
    const old = parse(
      JSON.parse(JSON.stringify(state).replace('"deck"', '"tabs"'))
    )!
    expect(display(old)).toEqual(["stack", "deck"])
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

  test("a Pane whose args change but not what makes it that Pane stays", () => {
    const before = open(start(), A, terminal("x1"))
    const after = structuredClone(before)
    after.list[0].columns[0].entries[0].pane.args.title = "cat"
    expect(left(before, after)).toHaveLength(1)
    const identity = (pane: PaneState): PaneState => ({
      kind: pane.kind,
      args: { terminal: pane.args.terminal },
    })
    expect(left(before, after, identity)).toEqual([])
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

describe("bringing a Pane here", () => {
  test("moves one another workspace shows beside the focused Pane", () => {
    let state = open(start(), A, thread("t1"))
    state = go(state, 1)
    state = open(state, A, terminal("x1"))
    state = bring(state, A, thread("t1"), { place: "right" })
    expect(columns(state)).toEqual([["x1"], ["t1"]])
    expect(focusName(state)).toBe("t1")
    expect(
      entries(state).filter((e) => e.pane.args.thread === "t1")
    ).toHaveLength(1)
  })

  test("focuses one this workspace shows, and opens one none shows", () => {
    let state = open(start(), A, thread("t1"))
    state = open(state, A, terminal("x1"), { place: "right" })
    state = bring(state, A, thread("t1"), { place: "right" })
    expect(columns(state)).toEqual([["t1"], ["x1"]])
    expect(focusName(state)).toBe("t1")
    state = bring(state, A, thread("t2"), { place: "right" })
    expect(columns(state)).toEqual([["t1"], ["t2"], ["x1"]])
  })
})
