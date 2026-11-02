import { describe, expect, test } from "vitest"
import { edgeSpeed, type Lane, landingAt } from "./moving"

/** Three columns 12 px apart: A alone, B over C, D alone. */
const LANES: Lane[] = [
  {
    id: "1",
    left: 0,
    right: 300,
    top: 0,
    bottom: 600,
    panes: ["a"],
    tiles: [{ top: 0, bottom: 600 }],
  },
  {
    id: "2",
    left: 312,
    right: 612,
    top: 0,
    bottom: 600,
    panes: ["b", "c"],
    tiles: [
      { top: 0, bottom: 294 },
      { top: 306, bottom: 600 },
    ],
  },
  {
    id: "3",
    left: 624,
    right: 924,
    top: 0,
    bottom: 600,
    panes: ["d"],
    tiles: [{ top: 0, bottom: 600 }],
  },
]

const land = (x: number, y: number, moving = "a", lanes = LANES) => {
  const at = landingAt(lanes, x, y, moving, 12)
  return at && { pane: at.pane, side: at.side }
}

describe("landingAt", () => {
  test("a column's edge, or the gap by it, makes a column on that side", () => {
    expect(land(330, 100, "c")).toEqual({ pane: "b", side: "left" })
    expect(land(600, 100, "c")).toEqual({ pane: "b", side: "right" })
    expect(land(616, 100, "c")).toEqual({ pane: "b", side: "right" })
    expect(land(2000, 100, "c")).toEqual({ pane: "d", side: "right" })
    expect(land(-50, 100, "c")).toEqual({ pane: "a", side: "left" })
  })

  test("a column's middle puts it over or under the Pane there", () => {
    expect(land(460, 100)).toEqual({ pane: "b", side: "above" })
    expect(land(460, 200)).toEqual({ pane: "b", side: "below" })
    expect(land(460, 580)).toEqual({ pane: "c", side: "below" })
  })

  test("where it would stay, it lands nowhere", () => {
    // A alone: its own column, and the edges next to it.
    expect(land(150, 300)).toBeUndefined()
    expect(land(20, 300)).toBeUndefined()
    expect(land(330, 100, "a")).toBeUndefined()
    // C under B: under B, or over itself.
    expect(land(460, 200, "c")).toBeUndefined()
    expect(land(460, 400, "c")).toBeUndefined()
    // Out of its stack, it may be a column of its own.
    expect(land(330, 100, "c")).toEqual({ pane: "b", side: "left" })
    expect(land(460, 100, "c")).toEqual({ pane: "b", side: "above" })
  })

  test("over a row of tabs, beside the tab; on the page, the last tab", () => {
    const tabbed: Lane[] = [
      LANES[0],
      {
        ...LANES[1],
        panes: ["b", "c", "e"],
        tiles: [{ top: 0, bottom: 600 }],
        tabs: [
          { left: 312, right: 412, top: 0, bottom: 36 },
          { left: 412, right: 512, top: 0, bottom: 36 },
          { left: 512, right: 612, top: 0, bottom: 36 },
        ],
      },
    ]
    expect(land(400, 20, "a", tabbed)).toEqual({ pane: "b", side: "below" })
    expect(land(420, 20, "a", tabbed)).toEqual({ pane: "c", side: "above" })
    expect(land(500, 300, "a", tabbed)).toEqual({ pane: "e", side: "below" })
  })

  test("the hint lies in the gap, or between the Panes", () => {
    const left = landingAt(LANES, 330, 100, "c", 12)!
    expect(left.hint).toEqual({ left: 304, top: 0, width: 4, height: 600 })
    const under = landingAt(LANES, 460, 200, "a", 12)!
    expect(under.hint).toEqual({ left: 312, top: 298, width: 300, height: 4 })
  })
})

describe("edgeSpeed", () => {
  test("from nothing at the edge's start to the fastest against it", () => {
    expect(edgeSpeed(0)).toBe(0)
    expect(edgeSpeed(96)).toBe(24)
    expect(edgeSpeed(200)).toBe(24)
    expect(edgeSpeed(48)).toBe(6)
  })
})
