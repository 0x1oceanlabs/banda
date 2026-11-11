import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Listed } from "@banda/ui/pane"
import type { Stand } from "@banda/ui/status"
import { describe, expect, test } from "vitest"
import type { Row } from "./rows"
import type { Went } from "./hold"
import type { Block } from "./inbox"
import {
  HEIGHTS,
  heightOf,
  heightOfAll,
  itemsOf,
  MOST,
  placesOf,
  plan,
  REGION_GAP,
  ROW_GAP,
} from "./motion"
import { regionsOf } from "./regions"

const project = { id: "s" as ProjectId, name: "S" } as ProjectSummary
const row = (id: string, stand: Stand): Row => ({
  project,
  listed: { id, title: id, mark: "rest", changed: 0 } as Listed,
  stand,
})
const cards = (stand: Stand, ids: string[]): Block => ({
  kind: "rows",
  key: stand,
  stand,
  rows: ids.map((id) => ({ row: row(id, stand), at: 0 })),
})
const head = (key: string, label: string): Block => ({
  kind: "head",
  key: `${key}:head`,
  label,
})
/** The list of `blocks`, each card of one line. */
const items = (
  blocks: Block[],
  held: { ghosts?: Map<string, Went>; leaving?: Map<string, Went> } = {}
) => itemsOf(regionsOf(blocks), () => 1, held)
const NONE = { heights: new Map<string, number>() }
const ids = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => `t${from + i}`)

describe("the heights, by arithmetic", () => {
  test("a card takes its lines' height, a part's cards stand 1 px apart and regions 4 px", () => {
    const list = items([
      head("turn", "Your turn"),
      cards("turn", ["a", "b"]),
      head("working", "Working"),
      cards("working", ["c"]),
    ])
    expect(list.map((item) => item.key)).toEqual([
      "turn:head",
      ":a",
      ":b",
      "working:head",
      ":c",
    ])
    const tops = placesOf(list, new Map()).map((place) => place.top)
    const card = HEIGHTS["card:1"]!
    const head0 = HEIGHTS.head!
    expect(tops).toEqual([
      0,
      head0,
      head0 + card + ROW_GAP,
      head0 + 2 * card + ROW_GAP + REGION_GAP,
      2 * head0 + 2 * card + ROW_GAP + REGION_GAP,
    ])
    expect(heightOfAll(list, new Map())).toBe(tops[4]! + card)
  })

  test("what the list measured counts before the design's", () => {
    const [card] = items([cards("open", ["a"])])
    expect(heightOf(card!, new Map())).toBe(28)
    expect(heightOf(card!, new Map([["card:1", 31]]))).toBe(31)
    const five = { ...card!, measure: "card:5", lines: 5 } as typeof card
    expect(heightOf(five!, new Map())).toBe(HEIGHTS["card:3"]! + 36)
  })
})

describe("what a batch plays", () => {
  const drawn = items([
    head("turn", "Your turn"),
    cards("turn", ["a", "b"]),
    cards("open", ["c", "d"]),
  ])

  test.each([
    {
      did: "a card goes, and those below it shift",
      next: [
        head("turn", "Your turn"),
        cards("turn", ["a"]),
        cards("open", ["c", "d"]),
      ],
      leaves: [":b"],
      arrivals: [],
      crossfades: [],
      shifted: [":c", ":d"],
    },
    {
      did: "a card comes",
      next: [
        head("turn", "Your turn"),
        cards("turn", ["a", "b", "e"]),
        cards("open", ["c", "d"]),
      ],
      leaves: [],
      arrivals: [":e"],
      crossfades: [],
      shifted: [":c", ":d"],
    },
    {
      did: "a card changes part: its node stays and fades in where it is",
      next: [
        head("turn", "Your turn"),
        cards("turn", ["a", "b", "c"]),
        cards("open", ["d"]),
      ],
      leaves: [],
      arrivals: [],
      crossfades: [":c"],
      shifted: [],
    },
    {
      did: "a part goes with its head",
      next: [cards("open", ["c", "d"])],
      leaves: ["turn:head", ":a", ":b"],
      arrivals: [],
      crossfades: [],
      shifted: [":c", ":d"],
    },
    {
      did: "nothing moves",
      next: [
        head("turn", "Your turn"),
        cards("turn", ["a", "b"]),
        cards("open", ["c", "d"]),
      ],
      leaves: [],
      arrivals: [],
      crossfades: [],
      shifted: [],
    },
  ])("$did", ({ next, leaves, arrivals, crossfades, shifted }) => {
    const moves = plan(drawn, items(next), NONE)
    expect(moves.leaves).toEqual(leaves)
    expect(moves.arrivals).toEqual(arrivals)
    expect(moves.crossfades).toEqual(crossfades)
    expect(moves.shifts.map((shift) => shift.key)).toEqual(shifted)
    expect(moves.snap).toBe(false)
  })

  test("a ghost line's slot closes still: it does not fade out again", () => {
    const ghosts = new Map<string, Went>([
      [":b", { to: "later", from: "turn" }],
    ])
    const held = items(
      [
        head("turn", "Your turn"),
        cards("turn", ["a", "b"]),
        cards("open", ["c", "d"]),
      ],
      { ghosts }
    )
    const released = items([
      head("turn", "Your turn"),
      cards("turn", ["a"]),
      cards("open", ["c", "d"]),
    ])
    expect(plan(held, released, NONE).leaves).toEqual([])
    // A card that stood dimmed fades out as the hold lets go.
    const leaving = new Map<string, Went>([
      [":b", { to: "archived", from: "turn" }],
    ])
    const dimmed = items(
      [
        head("turn", "Your turn"),
        cards("turn", ["a", "b"]),
        cards("open", ["c", "d"]),
      ],
      { leaving }
    )
    expect(plan(dimmed, released, NONE).leaves).toEqual([":b"])
  })

  test(`past ${MOST} moves, the whole batch snaps`, () => {
    const empty = items([cards("open", ["a"])])
    const most = items([cards("open", ["a", ...ids(0, MOST)])])
    const more = items([cards("open", ["a", ...ids(0, MOST + 1)])])
    expect(plan(empty, most, NONE).snap).toBe(false)
    expect(plan(empty, more, NONE).snap).toBe(true)
  })

  test("only what stands in view, and one each side, moves", () => {
    // Cards 28 px tall and 1 px apart: a view 0–100 px shows t0–t3.
    const before = items([cards("open", ids(0, 40))])
    const after = items([
      cards("open", ["new", ...ids(0, 20), ...ids(21, 40), "end"]),
    ])
    const moves = plan(before, after, {
      ...NONE,
      view: { top: 0, height: 100 },
    })
    // The new card in view comes; t20 far below goes without a fade, and
    // the card at the end comes as plainly.
    expect(moves.arrivals).toEqual([":new"])
    expect(moves.leaves).toEqual([])
    // 99 cards come, but those out of view only snap in: the batch plays.
    const many = items([cards("open", ids(0, 100))])
    const lots = plan(items([cards("open", ids(0, 1))]), many, {
      ...NONE,
      view: { top: 0, height: 100 },
    })
    expect(lots.arrivals).toEqual(ids(1, 5).map((id) => `:${id}`))
    expect(lots.snap).toBe(false)
  })
})
