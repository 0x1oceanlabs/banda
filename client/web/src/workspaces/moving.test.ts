import { describe, expect, test } from "vitest"
import {
  edgeSpeed,
  groupLandingAt,
  type Lane,
  landingAt,
  pushed,
} from "./moving"

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

describe("pushed", () => {
  test("back near the start, on near the end, still between", () => {
    expect(pushed(100, 100, 1000)).toBe(-24)
    expect(pushed(500, 100, 1000)).toBe(0)
    expect(pushed(1100, 100, 1000)).toBe(24)
    expect(pushed(1052, 100, 1000)).toBe(6)
  })

  test("at a Group's end, inside its plate goes in, past it out", () => {
    // B and C's column, then D, in a Group "g"; A out of it, 18 px off.
    const lanes = LANES.map((lane, i) => ({
      ...lane,
      ...(i > 0 && { group: "g", left: lane.left + 6, right: lane.right + 6 }),
    }))
    const at = (x: number) => {
      const landing = landingAt(lanes, x, 300, "z", 12)
      return landing && [landing.pane, landing.side, landing.grouped]
    }
    // The Group's first column starts at 318; its plate at 312.
    expect(at(314)).toEqual(["b", "left", true])
    expect(at(309)).toEqual(["b", "left", false])
    // Inside, between its columns, it says nothing of the Group.
    expect(at(625)).toEqual(["d", "left", undefined])
    // Past its last, which ends at 930: in to its plate's edge at 936.
    expect(at(933)).toEqual(["d", "right", true])
    expect(at(2000)).toEqual(["d", "right", false])
  })

  test("a Group by its handle lands between columns, never inside another", () => {
    // Columns 1 and 2 a Group "g", 3 alone, then 4 and 5 a Group "h".
    const lane = (id: string, n: number, group?: string): Lane => ({
      id,
      left: n * 100,
      right: n * 100 + 90,
      top: 0,
      bottom: 600,
      panes: [id],
      tiles: [{ top: 0, bottom: 600 }],
      ...(group && { group }),
    })
    const lanes = [
      lane("1", 0, "g"),
      lane("2", 1, "g"),
      lane("3", 2),
      lane("4", 3, "h"),
      lane("5", 4, "h"),
    ]
    const at = (x: number) => groupLandingAt(lanes, x, "g", 10)?.index
    // Where it stands, nothing; past 3, after it; into h, past h.
    expect(at(50)).toBeUndefined()
    expect(at(260)).toBe(1)
    expect(at(360)).toBe(3)
    expect(at(2000)).toBe(3)
    expect(groupLandingAt(lanes, 260, "g", 10)?.hint.left).toBe(293)
  })
})
