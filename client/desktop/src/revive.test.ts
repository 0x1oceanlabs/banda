import { describe, expect, it } from "@effect/vitest"
import { AGAIN_MOST, AGAIN_WITHIN, againAt } from "./revive"

describe("a page of Banda's that died loads again", () => {
  it("at most three times a minute", () => {
    const times: number[] = []
    for (let at = 0; at < AGAIN_MOST; at++)
      expect(againAt(times, at * 1000)).toBe(true)
    expect(againAt(times, 10_000)).toBe(false)
    // One refused is not counted: the first still falls out a minute on.
    expect(againAt(times, AGAIN_WITHIN - 1)).toBe(false)
    expect(againAt(times, AGAIN_WITHIN)).toBe(true)
  })

  it("again and again, when its deaths are a minute apart", () => {
    const times: number[] = []
    for (let minute = 0; minute < 10; minute++)
      expect(againAt(times, minute * AGAIN_WITHIN)).toBe(true)
  })
})
