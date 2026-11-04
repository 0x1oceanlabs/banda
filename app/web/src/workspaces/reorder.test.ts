import { describe, expect, test } from "vitest"
import { landing, offsets } from "./reorder"

/** Three workspaces 100 high, one under another, and the empty one. */
const PLACES = [
  { top: 0, height: 100 },
  { top: 100, height: 100 },
  { top: 200, height: 100 },
  { top: 300, height: 40 },
]

describe("landing", () => {
  test("a workspace lands past the middle of each it passes", () => {
    expect(landing(PLACES, 2, 0)).toBe(2)
    expect(landing(PLACES, 2, -99)).toBe(2)
    expect(landing(PLACES, 2, -101)).toBe(1)
    expect(landing(PLACES, 2, -201)).toBe(0)
    expect(landing(PLACES, 0, 201)).toBe(2)
  })

  test("never at or under the empty one at the bottom", () => {
    expect(landing(PLACES, 0, 1000)).toBe(2)
    expect(landing(PLACES, 2, 1000)).toBe(2)
  })
})

describe("offsets", () => {
  test("the ones passed step aside by its height, and it goes to its place", () => {
    expect(offsets(PLACES, 2, 0)).toEqual([100, 100, -200, 0])
    expect(offsets(PLACES, 0, 2)).toEqual([200, -100, -100, 0])
    expect(offsets(PLACES, 1, 1)).toEqual([0, 0, 0, 0])
  })
})
