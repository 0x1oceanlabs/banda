import type { PaneState } from "@bandaso/ui/pane"
import { expect, test } from "vitest"
import {
  close,
  EMPTY,
  focused,
  type Layout,
  left,
  move,
  type Node,
  open,
  parse,
  resize,
  show,
  split,
  tiles,
} from "./layout"

const list: PaneState = { kind: "agents.list", args: {} }
const thread = (id: string): PaneState => ({
  kind: "agents.thread",
  args: { agent: "a", name: "Writer", thread: id },
})
const browser: PaneState = { kind: "browser.page", args: {} }

/** The tree as kinds and shares, so a test reads like the desk looks. */
function shape(node: Node | null): unknown {
  if (!node) return null
  if (node.type === "tile") {
    const { thread } = node.pane.args
    return typeof thread === "string" ? `thread ${thread}` : node.pane.kind
  }
  return {
    [node.axis]: node.children.map(shape),
    sizes: node.sizes.map(Math.round),
  }
}

function kinds(layout: Layout) {
  return tiles(layout).map((tile) => shape(tile))
}

test("a Thread opens beside the list, and the next one takes its tile", () => {
  let desk = open(EMPTY, list)
  desk = open(desk, thread("1"), { share: 70 })
  expect(shape(desk.root)).toEqual({
    row: ["agents.list", "thread 1"],
    sizes: [30, 70],
  })
  desk = open(desk, list)
  expect(focused(desk)?.pane).toEqual(list)
  desk = open(desk, thread("2"))
  expect(kinds(desk)).toEqual(["agents.list", "thread 2"])
  expect(focused(desk)?.pane).toEqual(thread("2"))
})

test("a Pane already on the desk gets the focus instead of a second tile", () => {
  let desk = open(open(EMPTY, list), thread("1"))
  desk = open(desk, list)
  desk = open(desk, thread("1"), { place: "right" })
  expect(kinds(desk)).toEqual(["agents.list", "thread 1"])
  expect(focused(desk)?.pane).toEqual(thread("1"))
})

test("splitting along a split's own axis adds a sibling, across it nests", () => {
  let desk = open(open(EMPTY, list), thread("1"))
  desk = open(desk, thread("2"), { place: "right" })
  expect(shape(desk.root)).toEqual({
    row: ["agents.list", "thread 1", "thread 2"],
    sizes: [50, 25, 25],
  })
  desk = open(desk, browser, { place: "below" })
  expect(shape(desk.root)).toEqual({
    row: [
      "agents.list",
      "thread 1",
      { column: ["thread 2", "browser.page"], sizes: [50, 50] },
    ],
    sizes: [50, 25, 25],
  })
})

test("closing a tile gives its share back and the focus to the one before", () => {
  let desk = open(open(EMPTY, list), thread("1"))
  desk = open(desk, browser, { place: "below" })
  desk = close(desk, focused(desk)!.id)
  expect(shape(desk.root)).toEqual({
    row: ["agents.list", "thread 1"],
    sizes: [50, 50],
  })
  expect(focused(desk)?.pane).toEqual(thread("1"))
  desk = close(desk, focused(desk)!.id)
  expect(shape(desk.root)).toBe("agents.list")
  desk = close(desk, focused(desk)!.id)
  expect(desk).toEqual(EMPTY)
})

test("the focus moves to the neighbour in a direction, the last one used on a tie", () => {
  // list | thread 1
  //      | thread 2
  let desk = open(open(EMPTY, list), thread("1"))
  desk = open(desk, thread("2"), { place: "below" })
  expect(focused(move(desk, "up"))?.pane).toEqual(thread("1"))
  expect(focused(move(desk, "right"))).toBe(focused(desk))
  const left = move(desk, "left")
  expect(focused(left)?.pane).toEqual(list)
  expect(focused(move(left, "right"))?.pane).toEqual(thread("2"))
  const viaTop = move(move(move(desk, "up"), "left"), "right")
  expect(focused(viaTop)?.pane).toEqual(thread("1"))
})

test("a kept layout comes back, and a broken one is refused", () => {
  let desk = open(open(EMPTY, list), thread("1"))
  desk = resize(desk, desk.root!.id, [25, 75])
  const kept = parse(JSON.parse(JSON.stringify(desk)))
  expect(kept).toEqual(desk)
  expect(
    parse({
      root: { type: "split", id: "s", axis: "row", children: [], sizes: [] },
      recent: [],
    })
  ).toBeNull()
  expect(parse("nonsense")).toBeNull()
  expect(parse({ root: null, recent: ["gone"] })).toEqual(EMPTY)
})

test("a split always adds a tile, even for a Pane already shown", () => {
  const launcher: PaneState = { kind: "desk.launcher", args: {} }
  let desk = open(EMPTY, list)
  desk = split(desk, launcher, { place: "right" })
  desk = split(desk, launcher, { place: "below" })
  expect(shape(desk.root)).toEqual({
    row: [
      "agents.list",
      { column: ["desk.launcher", "desk.launcher"], sizes: [50, 50] },
    ],
    sizes: [50, 50],
  })
})

test("a Pane leaves the Desk when its tile closes or shows another Pane", () => {
  const terminal: PaneState = { kind: "terminal.terminal", args: { t: "1" } }
  const launcher: PaneState = { kind: "desk.launcher", args: {} }
  const desk = open(open(EMPTY, list), terminal, { place: "right" })
  const [first, second] = tiles(desk)
  expect(
    left(desk, split(desk, launcher, { from: second.id, place: "below" }))
  ).toEqual([])
  expect(left(desk, close(desk, second.id))).toEqual([terminal])
  expect(left(desk, show(desk, first.id, thread("1")))).toEqual([list])
  expect(left(desk, open(desk, thread("1")))).toEqual([])
})
