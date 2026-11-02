import { describe, expect, test } from "vitest"
import { free } from "./model"
import { type Box, grabAt, heightsFor, widthFor } from "./sizing"

/** Two columns 12 px apart; the second stacks two Panes, 12 px apart. */
const BOXES: Box[] = [
  { id: "a", left: 0, right: 300, top: 0, bottom: 600, tiles: [] },
  {
    id: "b",
    left: 312,
    right: 612,
    top: 0,
    bottom: 600,
    tiles: [
      { top: 0, bottom: 294 },
      { top: 306, bottom: 600 },
    ],
  },
]

describe("grabAt", () => {
  test("the gap right of a column sizes it, the last one's too", () => {
    expect(grabAt(BOXES, 306, 100, 12)).toEqual({
      kind: "width",
      column: "a",
    })
    expect(grabAt(BOXES, 616, 100, 12)).toEqual({
      kind: "width",
      column: "b",
    })
  })

  test("the gap between two Panes sizes their heights", () => {
    expect(grabAt(BOXES, 400, 300, 12)).toEqual({
      kind: "height",
      column: "b",
      pane: 0,
    })
  })

  test("a Pane itself, and the first column's left, take nothing", () => {
    expect(grabAt(BOXES, 150, 300, 12)).toBeUndefined()
    expect(grabAt(BOXES, -4, 300, 12)).toBeUndefined()
  })

  test("a gap thinner than the hand reaches into the Panes beside it", () => {
    const touching = BOXES.map((box) => ({ ...box }))
    touching[1] = { ...touching[1], left: 300 }
    expect(grabAt(touching, 303, 100, 0)?.kind).toBe("width")
    expect(grabAt(touching, 296, 100, 0)?.kind).toBe("width")
    expect(grabAt(touching, 290, 100, 0)).toBeUndefined()
  })
})

const STEPS = { steps: ["1/3", "1/2", "2/3", "1"], snap: 8, scale: 1000 }

describe("widthFor", () => {
  test("holds at a preset within snap pixels, else is as dragged", () => {
    expect(widthFor(0.505, STEPS)).toBe("1/2")
    expect(widthFor(0.42, STEPS)).toBe("0.42")
    expect(widthFor(0.4204, STEPS)).toBe("0.42")
    expect(widthFor(0.42, { ...STEPS, snap: 0 })).toBe("0.42")
    expect(widthFor(0.5, { ...STEPS, snap: 0 })).toBe("1/2")
  })

  test("never under the floor, nor over the whole", () => {
    expect(widthFor(0.1, STEPS, 0.25)).toBe("0.25")
    expect(widthFor(0.1, STEPS, 0.33)).toBe("1/3")
    expect(widthFor(1.4, STEPS)).toBe("1")
    expect(widthFor(0.34, STEPS, 0.4)).toBe("0.4")
  })
})

const HEIGHTS = { steps: ["1/3", "1/2", "2/3"], snap: 8, scale: 600 }

describe("heightsFor", () => {
  test("of two Panes, the one sized keeps its height and the other the rest", () => {
    const even = { heights: [0.5, 0.5], own: [undefined, undefined] }
    expect(heightsFor(even, 0, 0.6, HEIGHTS)).toEqual(["0.6", undefined])
    expect(heightsFor(even, 0, 0.67, HEIGHTS)).toEqual(["2/3", undefined])
    // The last one moves the gap over it.
    expect(heightsFor(even, 1, 0.3, HEIGHTS)).toEqual([undefined, "0.3"])
  })

  test("only the two beside the gap change; the rest stay where they are", () => {
    const three = {
      heights: [1 / 3, 1 / 3, 1 / 3],
      own: [undefined, undefined, undefined],
    }
    // The first still takes a third: the two below share two.
    expect(heightsFor(three, 1, 0.4, HEIGHTS)).toEqual([
      undefined,
      "0.4",
      free(2 / 3 - 0.4),
    ])
    const owned = { heights: [0.2, 0.5, 0.3], own: ["0.2", "1/2", undefined] }
    expect(heightsFor(owned, 0, 0.3, HEIGHTS)).toEqual([
      "0.3",
      "0.4",
      undefined,
    ])
    expect(heightsFor(owned, 1, 0.4, HEIGHTS)).toEqual([
      "0.2",
      "0.4",
      undefined,
    ])
  })

  test("neither gets less than the least, and a step past it does not hold", () => {
    const even = { heights: [0.5, 0.5], own: [undefined, undefined] }
    expect(heightsFor(even, 0, 0.95, HEIGHTS, 0.1)).toEqual(["0.9", undefined])
    expect(heightsFor(even, 0, 0.01, HEIGHTS, 0.1)).toEqual(["0.1", undefined])
    expect(heightsFor(even, 0, 0.66, { ...HEIGHTS, snap: 50 }, 0.4)).toEqual([
      "0.6",
      undefined,
    ])
  })

  test("a Pane alone has nothing to share", () => {
    const alone = { heights: [1], own: [undefined] }
    expect(heightsFor(alone, 0, 0.5, HEIGHTS)).toEqual([undefined])
  })
})
