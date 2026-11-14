import { describe, expect, test } from "vitest"
import { landing, type Place, revealTo } from "./layout"

/** The room of a Strip: what shows starts 16 in, past the sidebar, and is
 * 1000 wide. */
const ROOM = { pad: 16, inner: 1000 }

/** The places of columns of these widths, a gap of 8 between them, from
 * the room's left. */
function placed(...columns: [string, number][]): Place[] {
  let left = ROOM.pad
  return columns.map(([id, width]) => {
    const place = { id, left, right: left + width }
    left += width + 8
    return place
  })
}

describe("a column comes into view", () => {
  test("in the row, by the least scroll that shows it, and never past the Strip's ends", () => {
    const all = placed(["a", 496], ["b", 496], ["c", 496], ["d", 496])
    const never = { center: "never" } as const
    // To the right: its right edge to the room's right.
    expect(revealTo(all, ROOM, 0, "c", never)).toBe(504)
    // To the left: its left edge to the room's left.
    expect(revealTo(all, ROOM, 1008, "a", never)).toBe(0)
    // Whole in view already: the scroll stays.
    expect(revealTo(all, ROOM, 300, "b", never)).toBe(300)
    // The middle, as far as the Strip goes.
    expect(revealTo(all, ROOM, 0, "d", { center: "always" })).toBe(1008)
    expect(revealTo(all, ROOM, 0, "x", never)).toBeUndefined()
  })

  test("with its Group from its first column, and a Group wider than the screen keeps the focused column whole (ADR 0102, decision 8)", () => {
    // Solo: an Agent alone, a Group of two halves, another Agent.
    const all = placed(
      ["a", 1000],
      ["hello", 496],
      ["terminal", 496],
      ["second", 1000]
    )
    const left = (id: string, first: string, at: number) =>
      revealTo(all, ROOM, at, id, { center: "left", first })
    // From the Agent on its right, the last column of the Group brings
    // the Group whole, from hello, not by the least scroll.
    expect(revealTo(all, ROOM, 2016, "terminal", { center: "never" })).toBe(
      1512
    )
    expect(left("terminal", "hello", 2016)).toBe(1008)
    // From the Agent on its left, its first column alike.
    expect(left("hello", "hello", 0)).toBe(1008)
    // Inside the Group, nothing moves.
    expect(left("hello", "hello", 1008)).toBe(1008)
    // hello made the screen wide: the Group is wider than the screen, and
    // its second column comes whole, at the room's right.
    const wide = placed(
      ["a", 1000],
      ["hello", 1000],
      ["terminal", 328],
      ["second", 1000]
    )
    expect(
      revealTo(wide, ROOM, 0, "terminal", { center: "left", first: "hello" })
    ).toBe(1344)
    expect(
      revealTo(wide, ROOM, 0, "hello", { center: "left", first: "hello" })
    ).toBe(1008)
  })
})

describe("a swipe let go lands", () => {
  // Five halves, 496 wide with a gap of 8: snaps every 504.
  const all = placed(["a", 496], ["b", 496], ["c", 496], ["d", 496], ["e", 496])
  const free = all.map(() => ({}))
  const land = (from: number, rest: number, columns: object[] = free) =>
    landing(all, columns, ROOM, "never", { from, rest })

  test("on the edge nearest to where it would rest, its column the furthest whole the way it went", () => {
    expect(land(0, 300)).toEqual({ at: 504, id: "c" })
    // A small throw: back where it was, the focus on the right one whole.
    expect(land(0, 200)).toEqual({ at: 0, id: "b" })
    // Back to the left: the furthest whole that way is the left one.
    expect(land(1008, 700)).toEqual({ at: 504, id: "b" })
  })

  test("never past the first column or the last", () => {
    expect(land(0, -900)).toEqual({ at: 0, id: "a" })
    expect(land(0, 9000)).toEqual({ at: 1512, id: "e" })
  })

  test("a Group that fills the screen only whole, at its ends", () => {
    // b and c one Group, filling the screen.
    const columns = [
      {},
      { filled: true, ends: { first: true, last: false } },
      { filled: true, ends: { first: false, last: true } },
      {},
      {},
    ]
    // Nearer d's right edge, which would cut the Group: it lands whole.
    expect(land(0, 900, columns)).toEqual({ at: 504, id: "c" })
    expect(land(0, 1300, columns)).toEqual({ at: 1512, id: "e" })
  })

  test("in the middle with center = always", () => {
    const thirds = placed(["a", 328], ["b", 328], ["c", 328], ["d", 328])
    const at = (rest: number) =>
      landing(
        thirds,
        thirds.map(() => ({})),
        ROOM,
        "always",
        { from: 0, rest }
      )
    // b's middle meets the room's at 0, c's at 336.
    expect(at(120)).toEqual({ at: 0, id: "b" })
    expect(at(200)).toEqual({ at: 336, id: "c" })
  })
})
